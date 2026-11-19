import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { redactSecrets } from './security.mjs';

export function defaultDbPath() {
  if (process.env.FACTORY_DB_PATH) return resolve(process.env.FACTORY_DB_PATH);
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  return join(home, '.gemini', 'factory', 'factory.db');
}

export function projectIdForPath(projectPath) {
  const norm = resolve(projectPath).toLowerCase();
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  adapter_ids TEXT NOT NULL DEFAULT '[]',
  config_json TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  current_stage TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pipeline_id TEXT REFERENCES pipelines(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  criteria TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'implementation',
  agent_role TEXT NOT NULL DEFAULT 'backend',
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 50,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  branch TEXT,
  worktree TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  verification_json TEXT,
  approval_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  event TEXT NOT NULL,
  actor TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pipeline_id TEXT,
  task_id TEXT,
  agent_role TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gate_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT,
  revision TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  config_hash TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  results_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  file_path TEXT,
  line_number INTEGER DEFAULT 0,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT,
  reviewer_role TEXT NOT NULL,
  severity TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT,
  version TEXT NOT NULL,
  revision TEXT,
  gate_run_id TEXT,
  status TEXT NOT NULL,
  notes TEXT NOT NULL,
  rollback_plan TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT,
  release_id TEXT,
  action TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  reason TEXT,
  revision TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pipeline_id TEXT,
  task_id TEXT,
  agent_role TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  output_summary TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_logs_project_time ON execution_logs(project_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_gates_project_time ON gate_runs(project_id, created_at DESC);
`;

const stamp = () => new Date().toISOString();

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** Open and initialize the SQLite factory store. */
export function openFactoryDb(dbPath = defaultDbPath()) {
  const fullPath = resolve(dbPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  const db = new DatabaseSync(fullPath);
  db.exec(SCHEMA_SQL);

  const stmts = {
    upsertProject: db.prepare(`
      INSERT INTO projects (id, name, path, adapter_ids, config_json, config_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        adapter_ids = excluded.adapter_ids,
        config_json = excluded.config_json,
        config_hash = excluded.config_hash,
        updated_at = excluded.updated_at
    `),
    getProjectByPath: db.prepare('SELECT * FROM projects WHERE path = ?'),
    getProjectById: db.prepare('SELECT * FROM projects WHERE id = ?'),
    listProjects: db.prepare('SELECT * FROM projects ORDER BY updated_at DESC'),
    insertPipeline: db.prepare(`
      INSERT INTO pipelines (id, project_id, goal, current_stage, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    updatePipeline: db.prepare(`
      UPDATE pipelines SET current_stage = ?, status = ?, updated_at = ? WHERE id = ?
    `),
    listPipelines: db.prepare('SELECT * FROM pipelines WHERE project_id = ? ORDER BY created_at DESC'),
    upsertTask: db.prepare(`
      INSERT INTO tasks (
        id, project_id, pipeline_id, title, criteria, stage, agent_role, status, priority,
        depends_on_json, branch, worktree, attempts, max_retries, lease_owner, lease_expires_at,
        last_error, verification_json, approval_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        pipeline_id = excluded.pipeline_id,
        title = excluded.title,
        criteria = excluded.criteria,
        stage = excluded.stage,
        agent_role = excluded.agent_role,
        status = excluded.status,
        priority = excluded.priority,
        depends_on_json = excluded.depends_on_json,
        branch = excluded.branch,
        worktree = excluded.worktree,
        attempts = excluded.attempts,
        max_retries = excluded.max_retries,
        lease_owner = excluded.lease_owner,
        lease_expires_at = excluded.lease_expires_at,
        last_error = excluded.last_error,
        verification_json = excluded.verification_json,
        approval_json = excluded.approval_json,
        updated_at = excluded.updated_at
    `),
    getTask: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    listTasksByProject: db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY priority ASC, created_at ASC'),
    listAllTasks: db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC'),
    deleteProjectTasks: db.prepare('DELETE FROM tasks WHERE project_id = ?'),
    deleteProjectPipelines: db.prepare('DELETE FROM pipelines WHERE project_id = ?'),
    addHistory: db.prepare('INSERT INTO task_history (task_id, project_id, event, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    getHistory: db.prepare('SELECT * FROM task_history WHERE task_id = ? ORDER BY id ASC'),
    addLog: db.prepare('INSERT INTO execution_logs (project_id, pipeline_id, task_id, agent_role, level, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    listLogs: db.prepare('SELECT * FROM execution_logs WHERE project_id = ? ORDER BY id DESC LIMIT ?'),
    listAllLogs: db.prepare('SELECT * FROM execution_logs ORDER BY id DESC LIMIT ?'),
    addGateRun: db.prepare(`
      INSERT INTO gate_runs (id, project_id, task_id, revision, dirty, config_hash, ok, results_json, metrics_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listGateRuns: db.prepare('SELECT * FROM gate_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'),
    clearOpenSecurity: db.prepare("DELETE FROM security_findings WHERE project_id = ? AND COALESCE(task_id,'') = COALESCE(?,'') AND status = 'open'"),
    addSecurityFinding: db.prepare(`
      INSERT INTO security_findings (id, project_id, task_id, severity, category, file_path, line_number, summary, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listSecurityFindings: db.prepare('SELECT * FROM security_findings WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'),
    addReviewFinding: db.prepare(`
      INSERT INTO review_findings (id, project_id, task_id, reviewer_role, severity, summary, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listReviewFindings: db.prepare('SELECT * FROM review_findings WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'),
    addRelease: db.prepare(`
      INSERT INTO releases (id, project_id, task_id, version, revision, gate_run_id, status, notes, rollback_plan, approved_by, approved_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateReleaseApproval: db.prepare('UPDATE releases SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?'),
    listReleases: db.prepare('SELECT * FROM releases WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'),
    addApproval: db.prepare(`
      INSERT INTO approvals (id, project_id, task_id, release_id, action, requested_by, status, decided_by, reason, revision, created_at, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    decideApproval: db.prepare('UPDATE approvals SET status = ?, decided_by = ?, reason = ?, decided_at = ? WHERE id = ?'),
    listApprovals: db.prepare('SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'),
    listAllApprovals: db.prepare('SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?'),
    addAgentRun: db.prepare(`
      INSERT INTO agent_runs (id, project_id, pipeline_id, task_id, agent_role, provider, status, started_at, finished_at, output_summary, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    finishAgentRun: db.prepare('UPDATE agent_runs SET status = ?, finished_at = ?, output_summary = ?, error = ? WHERE id = ?'),
    listAgentRuns: db.prepare('SELECT * FROM agent_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?')
  };

  function hydrateTask(row) {
    if (!row) return null;
    const history = stmts.getHistory.all(row.id).map(h => ({
      at: h.created_at,
      event: h.event,
      actor: h.actor || undefined,
      detail: h.detail || undefined
    }));
    return {
      id: row.id,
      project_id: row.project_id,
      pipeline_id: row.pipeline_id,
      title: row.title,
      criteria: row.criteria,
      stage: row.stage,
      agent_role: row.agent_role,
      status: row.status,
      priority: row.priority,
      depends_on: safeJsonParse(row.depends_on_json, []),
      branch: row.branch,
      worktree: row.worktree,
      attempts: row.attempts,
      max_retries: row.max_retries,
      lease_owner: row.lease_owner,
      lease_expires_at: row.lease_expires_at,
      last_error: row.last_error,
      verification: safeJsonParse(row.verification_json, null),
      approval: safeJsonParse(row.approval_json, null),
      created_at: row.created_at,
      updated_at: row.updated_at,
      history
    };
  }

  return {
    path: fullPath,
    close() { db.close(); },

    upsertProject({ name, path, adapterIds = [], config, configHash }) {
      const absPath = resolve(path);
      const id = projectIdForPath(absPath);
      const now = stamp();
      stmts.upsertProject.run(
        id,
        name,
        absPath,
        JSON.stringify(adapterIds),
        JSON.stringify(config),
        configHash,
        now,
        now
      );
      return this.getProject(absPath);
    },

    getProject(pathOrId) {
      const byId = stmts.getProjectById.get(pathOrId);
      const row = byId || stmts.getProjectByPath.get(resolve(pathOrId));
      if (!row) return null;
      return {
        ...row,
        adapter_ids: safeJsonParse(row.adapter_ids, []),
        config: safeJsonParse(row.config_json, {})
      };
    },

    listProjects() {
      return stmts.listProjects.all().map(row => ({
        ...row,
        adapter_ids: safeJsonParse(row.adapter_ids, []),
        config: safeJsonParse(row.config_json, {})
      }));
    },

    createPipeline(projectId, goal, currentStage = 'requirements', status = 'active') {
      const id = `pipe-${randomUUID().slice(0, 8)}`;
      const now = stamp();
      stmts.insertPipeline.run(id, projectId, goal, currentStage, status, now, now);
      return { id, project_id: projectId, goal, current_stage: currentStage, status, created_at: now, updated_at: now };
    },

    updatePipeline(id, currentStage, status) {
      stmts.updatePipeline.run(currentStage, status, stamp(), id);
    },

    listPipelines(projectId) {
      return stmts.listPipelines.all(projectId);
    },

    saveTask(projectId, t) {
      const now = stamp();
      stmts.upsertTask.run(
        t.id,
        projectId,
        t.pipeline_id || null,
        t.title,
        t.criteria || '',
        t.stage || 'implementation',
        t.agent_role || 'backend',
        t.status || 'queued',
        t.priority ?? 50,
        JSON.stringify(t.depends_on || []),
        t.branch || null,
        t.worktree || null,
        t.attempts ?? 0,
        t.max_retries ?? 2,
        t.lease_owner || null,
        t.lease_expires_at || null,
        t.last_error ? redactSecrets(t.last_error) : null,
        t.verification ? JSON.stringify(t.verification) : null,
        t.approval ? JSON.stringify(t.approval) : null,
        t.created_at || now,
        t.updated_at || now
      );
      return hydrateTask(stmts.getTask.get(t.id));
    },

    recordTaskEvent(projectId, taskId, event, actor = null, detail = null) {
      stmts.addHistory.run(taskId, projectId, event, actor, detail ? redactSecrets(detail) : null, stamp());
    },

    getTask(taskId) {
      return hydrateTask(stmts.getTask.get(taskId));
    },

    listTasks(projectId) {
      return projectId
        ? stmts.listTasksByProject.all(projectId).map(hydrateTask)
        : stmts.listAllTasks.all().map(hydrateTask);
    },

    resetProjectTasks(projectId) {
      stmts.deleteProjectTasks.run(projectId);
      stmts.deleteProjectPipelines.run(projectId);
    },

    log(projectId, message, { pipelineId = null, taskId = null, agentRole = null, level = 'info' } = {}) {
      stmts.addLog.run(projectId, pipelineId, taskId, agentRole, level, redactSecrets(message), stamp());
    },

    listLogs(projectId = null, limit = 100) {
      return projectId ? stmts.listLogs.all(projectId, limit) : stmts.listAllLogs.all(limit);
    },

    recordGateRun(projectId, report, metrics = {}) {
      const id = `gate-${randomUUID().slice(0, 8)}`;
      stmts.addGateRun.run(
        id,
        projectId,
        report.task_id || null,
        report.revision || null,
        report.dirty ? 1 : 0,
        report.config_hash,
        report.ok ? 1 : 0,
        JSON.stringify(report.results || []),
        JSON.stringify(metrics),
        report.at || stamp()
      );
      return id;
    },

    listGateRuns(projectId, limit = 30) {
      return stmts.listGateRuns.all(projectId, limit).map(r => ({
        ...r,
        dirty: Boolean(r.dirty),
        ok: Boolean(r.ok),
        results: safeJsonParse(r.results_json, []),
        metrics: safeJsonParse(r.metrics_json, {})
      }));
    },

    replaceOpenSecurityFindings(projectId, taskId, findings) {
      stmts.clearOpenSecurity.run(projectId, taskId || null);
      const now = stamp();
      for (const f of findings) {
        stmts.addSecurityFinding.run(
          `sec-${randomUUID().slice(0, 8)}`,
          projectId,
          taskId || null,
          f.severity || 'medium',
          f.category || 'security',
          f.file || null,
          f.line || 0,
          redactSecrets(f.summary || ''),
          'open',
          now
        );
      }
    },

    listSecurityFindings(projectId, limit = 100) {
      return stmts.listSecurityFindings.all(projectId, limit);
    },

    addReviewFinding(projectId, { taskId = null, reviewerRole = 'code_review', severity = 'info', summary, status = 'open' }) {
      const id = `rev-${randomUUID().slice(0, 8)}`;
      stmts.addReviewFinding.run(id, projectId, taskId, reviewerRole, severity, redactSecrets(summary), status, stamp());
      return id;
    },

    listReviewFindings(projectId, limit = 100) {
      return stmts.listReviewFindings.all(projectId, limit);
    },

    createRelease(projectId, { taskId = null, version, revision = null, gateRunId = null, status, notes, rollbackPlan, approvedBy = null }) {
      const id = `rel-${randomUUID().slice(0, 8)}`;
      const now = stamp();
      stmts.addRelease.run(
        id, projectId, taskId, version, revision, gateRunId, status,
        redactSecrets(notes), redactSecrets(rollbackPlan),
        approvedBy, approvedBy ? now : null, now
      );
      return id;
    },

    approveRelease(releaseId, approvedBy) {
      stmts.updateReleaseApproval.run('approved', approvedBy, stamp(), releaseId);
    },

    listReleases(projectId, limit = 30) {
      return stmts.listReleases.all(projectId, limit);
    },

    requestApproval(projectId, { taskId = null, releaseId = null, action, requestedBy = 'director', revision = null }) {
      const id = `apr-${randomUUID().slice(0, 8)}`;
      stmts.addApproval.run(id, projectId, taskId, releaseId, action, requestedBy, 'pending', null, null, revision, stamp(), null);
      return id;
    },

    decideApproval(approvalId, { status, decidedBy, reason = '' }) {
      stmts.decideApproval.run(status, decidedBy, redactSecrets(reason), stamp(), approvalId);
    },

    listApprovals(projectId = null, limit = 50) {
      return projectId ? stmts.listApprovals.all(projectId, limit) : stmts.listAllApprovals.all(limit);
    },

    startAgentRun(projectId, { pipelineId = null, taskId = null, agentRole, provider }) {
      const id = `run-${randomUUID().slice(0, 8)}`;
      stmts.addAgentRun.run(id, projectId, pipelineId, taskId, agentRole, provider, 'running', stamp(), null, null, null);
      return id;
    },

    finishAgentRun(id, { status, outputSummary = null, error = null }) {
      stmts.finishAgentRun.run(
        status,
        stamp(),
        outputSummary ? redactSecrets(outputSummary) : null,
        error ? redactSecrets(error) : null,
        id
      );
    },

    listAgentRuns(projectId, limit = 50) {
      return stmts.listAgentRuns.all(projectId, limit);
    }
  };
}
