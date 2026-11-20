import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { redactSecrets } from './security.mjs';
import { getSchemaVersion, runMigrations } from './migrations.mjs';

export function defaultGlobalHome() {
  if (process.env.FACTORY_GLOBAL_HOME) return resolve(process.env.FACTORY_GLOBAL_HOME);
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  return join(home, '.gemini', 'factory');
}

export function defaultGlobalMemoryDbPath() {
  if (process.env.FACTORY_GLOBAL_MEMORY_DB) return resolve(process.env.FACTORY_GLOBAL_MEMORY_DB);
  return join(defaultGlobalHome(), 'memory', 'global-memory.db');
}

export function defaultDbPath() {
  if (process.env.FACTORY_DB_PATH) return resolve(process.env.FACTORY_DB_PATH);
  return join(defaultGlobalHome(), 'factory.db');
}

export function projectIdForPath(projectPath) {
  const norm = resolve(projectPath).toLowerCase();
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

const stamp = () => new Date().toISOString();

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** Open and initialize or migrate the SQLite factory store. */
export function openFactoryDb(dbPath = defaultDbPath()) {
  const fullPath = resolve(dbPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  const db = new DatabaseSync(fullPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  runMigrations(db);

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
    listAgentRuns: db.prepare('SELECT * FROM agent_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?'),

    upsertProfile: db.prepare(`
      INSERT INTO project_profiles (project_id, profile_id, detected_stack_json, override_by, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        profile_id = excluded.profile_id,
        detected_stack_json = excluded.detected_stack_json,
        override_by = excluded.override_by,
        updated_at = excluded.updated_at
    `),
    getProfile: db.prepare('SELECT * FROM project_profiles WHERE project_id = ?'),

    upsertMemory: db.prepare(`
      INSERT INTO memories (
        id, type, scope, project_id, category, statement, evidence_ref, source_type,
        confidence, verification_status, tags_json, profile_scope, version, status,
        fingerprint, created_at, updated_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        scope = excluded.scope,
        project_id = excluded.project_id,
        category = excluded.category,
        statement = excluded.statement,
        evidence_ref = excluded.evidence_ref,
        source_type = excluded.source_type,
        confidence = excluded.confidence,
        verification_status = excluded.verification_status,
        tags_json = excluded.tags_json,
        profile_scope = excluded.profile_scope,
        version = excluded.version,
        status = excluded.status,
        fingerprint = excluded.fingerprint,
        updated_at = excluded.updated_at,
        last_used_at = excluded.last_used_at
    `),
    getMemory: db.prepare('SELECT * FROM memories WHERE id = ?'),
    findMemoryByFingerprint: db.prepare('SELECT * FROM memories WHERE fingerprint = ? LIMIT 1'),
    updateMemoryStatus: db.prepare('UPDATE memories SET status = ?, verification_status = ?, updated_at = ? WHERE id = ?'),
    touchMemory: db.prepare('UPDATE memories SET last_used_at = ? WHERE id = ?'),
    deleteMemory: db.prepare('DELETE FROM memories WHERE id = ?'),

    upsertSkill: db.prepare(`
      INSERT INTO skill_registry (
        name, source, source_type, version_ref, commit_sha, sha256, license,
        compatible_ides_json, required_tools_json, install_status, approval_status,
        dependencies_json, security_summary, installed_paths_json, last_verified_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        source = excluded.source,
        source_type = excluded.source_type,
        version_ref = excluded.version_ref,
        commit_sha = excluded.commit_sha,
        sha256 = excluded.sha256,
        license = excluded.license,
        compatible_ides_json = excluded.compatible_ides_json,
        required_tools_json = excluded.required_tools_json,
        install_status = excluded.install_status,
        approval_status = excluded.approval_status,
        dependencies_json = excluded.dependencies_json,
        security_summary = excluded.security_summary,
        installed_paths_json = excluded.installed_paths_json,
        last_verified_at = excluded.last_verified_at,
        updated_at = excluded.updated_at
    `),
    getSkill: db.prepare('SELECT * FROM skill_registry WHERE name = ?'),
    listSkills: db.prepare('SELECT * FROM skill_registry ORDER BY name ASC'),
    deleteSkill: db.prepare('DELETE FROM skill_registry WHERE name = ?'),

    addRouting: db.prepare(`
      INSERT INTO routing_decisions (
        id, project_id, task_id, request_summary, profile_id, complexity,
        primary_agent, supporting_agents_json, selected_skills_json, references_json,
        estimated_budget_chars, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listRoutingByProject: db.prepare('SELECT * FROM routing_decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'),
    listAllRouting: db.prepare('SELECT * FROM routing_decisions ORDER BY created_at DESC LIMIT ?'),

    addContextMetric: db.prepare(`
      INSERT INTO context_metrics (
        id, project_id, task_id, mode, input_tokens, output_tokens,
        estimated_context_bytes, baseline_context_bytes, duration_ms,
        agent_invocations, cost_usd, retry_count, success, verification_coverage, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listContextByProject: db.prepare('SELECT * FROM context_metrics WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'),
    listAllContext: db.prepare('SELECT * FROM context_metrics ORDER BY created_at DESC LIMIT ?'),

    addUpdateEvent: db.prepare(`
      INSERT INTO update_history (id, from_version, to_version, from_commit, to_commit, action, status, backup_path, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listUpdateHistory: db.prepare('SELECT * FROM update_history ORDER BY created_at DESC LIMIT ?'),

    upsertImprovement: db.prepare(`
      INSERT INTO improvement_proposals (id, category, title, hypothesis, evidence_json, status, metrics_before_json, metrics_after_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        evidence_json = excluded.evidence_json,
        metrics_before_json = excluded.metrics_before_json,
        metrics_after_json = excluded.metrics_after_json,
        updated_at = excluded.updated_at
    `),
    listImprovements: db.prepare('SELECT * FROM improvement_proposals ORDER BY updated_at DESC LIMIT ?'),

    addDeploymentAdvice: db.prepare(`
      INSERT INTO deployment_advice (id, project_id, profile_id, recommended_platform, options_json, plan_markdown, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    listDeploymentAdviceByProject: db.prepare('SELECT * FROM deployment_advice WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'),
    listAllDeploymentAdvice: db.prepare('SELECT * FROM deployment_advice ORDER BY created_at DESC LIMIT ?')
  };

  function hydrateMemory(row) {
    if (!row) return null;
    return {
      ...row,
      tags: safeJsonParse(row.tags_json, [])
    };
  }

  function hydrateSkill(row) {
    if (!row) return null;
    return {
      ...row,
      compatible_ides: safeJsonParse(row.compatible_ides_json, []),
      required_tools: safeJsonParse(row.required_tools_json, []),
      dependencies: safeJsonParse(row.dependencies_json, []),
      installed_paths: safeJsonParse(row.installed_paths_json, [])
    };
  }

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
    },

    schemaVersion() {
      return getSchemaVersion(db);
    },

    checkpoint() {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    },

    setProjectProfile(projectId, { profileId, detectedStack = [], overrideBy = null }) {
      const now = stamp();
      stmts.upsertProfile.run(projectId, profileId, JSON.stringify(detectedStack), overrideBy, now);
      return this.getProjectProfile(projectId);
    },

    getProjectProfile(projectId) {
      const row = stmts.getProfile.get(projectId);
      if (!row) return null;
      return { ...row, detected_stack: safeJsonParse(row.detected_stack_json, []) };
    },

    upsertMemory(entry) {
      const now = stamp();
      const id = entry.id || `mem-${randomUUID().slice(0, 10)}`;
      stmts.upsertMemory.run(
        id,
        entry.type || 'observation',
        entry.scope || 'project',
        entry.project_id || null,
        entry.category || 'engineering',
        redactSecrets(entry.statement || ''),
        entry.evidence_ref ? redactSecrets(entry.evidence_ref) : null,
        entry.source_type || 'system',
        Number(entry.confidence ?? 0.5),
        entry.verification_status || 'candidate',
        JSON.stringify(entry.tags || []),
        entry.profile_scope || null,
        Number(entry.version ?? 1),
        entry.status || 'active',
        entry.fingerprint,
        entry.created_at || now,
        entry.updated_at || now,
        entry.last_used_at || null
      );
      return this.getMemory(id);
    },

    getMemory(id) {
      return hydrateMemory(stmts.getMemory.get(id));
    },

    findMemoryByFingerprint(fingerprint) {
      return hydrateMemory(stmts.findMemoryByFingerprint.get(fingerprint));
    },

    listMemories({ scope = null, projectId = null, category = null, status = null, verificationStatus = null, profileScope = null, query = null, limit = 100 } = {}) {
      const clauses = [];
      const params = [];
      if (scope) { clauses.push('scope = ?'); params.push(scope); }
      if (projectId) { clauses.push('project_id = ?'); params.push(projectId); }
      if (category) { clauses.push('category = ?'); params.push(category); }
      if (status) { clauses.push('status = ?'); params.push(status); }
      if (verificationStatus) { clauses.push('verification_status = ?'); params.push(verificationStatus); }
      if (profileScope) { clauses.push('profile_scope = ?'); params.push(profileScope); }
      if (query) {
        clauses.push('(LOWER(statement) LIKE ? OR LOWER(category) LIKE ? OR LOWER(tags_json) LIKE ?)');
        const q = `%${String(query).toLowerCase()}%`;
        params.push(q, q, q);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const sql = `SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT ?`;
      params.push(Number(limit));
      return db.prepare(sql).all(...params).map(hydrateMemory);
    },

    updateMemoryStatus(id, { status, verification_status }) {
      const cur = this.getMemory(id);
      if (!cur) return null;
      stmts.updateMemoryStatus.run(
        status ?? cur.status,
        verification_status ?? cur.verification_status,
        stamp(),
        id
      );
      return this.getMemory(id);
    },

    touchMemories(ids = []) {
      const now = stamp();
      for (const id of ids) {
        stmts.touchMemory.run(now, id);
      }
    },

    deleteMemory(id) {
      const cur = this.getMemory(id);
      stmts.deleteMemory.run(id);
      return cur;
    },

    upsertSkillRecord(rec) {
      const now = stamp();
      stmts.upsertSkill.run(
        rec.name,
        rec.source || 'local',
        rec.source_type || 'local',
        rec.version_ref || null,
        rec.commit_sha || null,
        rec.sha256 || null,
        rec.license || null,
        JSON.stringify(rec.compatible_ides || ['antigravity', 'cursor']),
        JSON.stringify(rec.required_tools || []),
        rec.install_status || 'installed',
        rec.approval_status || 'allowlisted',
        JSON.stringify(rec.dependencies || []),
        rec.security_summary || null,
        JSON.stringify(rec.installed_paths || []),
        rec.last_verified_at || now,
        now
      );
      return this.getSkillRecord(rec.name);
    },

    getSkillRecord(name) {
      return hydrateSkill(stmts.getSkill.get(name));
    },

    listSkillRecords() {
      return stmts.listSkills.all().map(hydrateSkill);
    },

    deleteSkillRecord(name) {
      stmts.deleteSkill.run(name);
    },

    recordRoutingDecision(rec) {
      const id = rec.id || `route-${randomUUID().slice(0, 8)}`;
      const now = stamp();
      stmts.addRouting.run(
        id,
        rec.project_id || null,
        rec.task_id || null,
        redactSecrets(rec.request_summary || ''),
        rec.profile_id || null,
        rec.complexity || 'STANDARD',
        rec.primary_agent,
        JSON.stringify(rec.supporting_agents || []),
        JSON.stringify(rec.selected_skills || []),
        JSON.stringify(rec.references || []),
        rec.estimated_budget_chars ?? null,
        now
      );
      return id;
    },

    listRoutingDecisions(projectId = null, limit = 50) {
      const rows = projectId
        ? stmts.listRoutingByProject.all(projectId, limit)
        : stmts.listAllRouting.all(limit);
      return rows.map(r => ({
        ...r,
        supporting_agents: safeJsonParse(r.supporting_agents_json, []),
        selected_skills: safeJsonParse(r.selected_skills_json, []),
        references: safeJsonParse(r.references_json, [])
      }));
    },

    recordContextMetric(rec) {
      const id = rec.id || `ctx-${randomUUID().slice(0, 8)}`;
      stmts.addContextMetric.run(
        id,
        rec.project_id || null,
        rec.task_id || null,
        rec.mode || 'STANDARD',
        rec.input_tokens ?? null,
        rec.output_tokens ?? null,
        Number(rec.estimated_context_bytes || 0),
        rec.baseline_context_bytes ?? null,
        rec.duration_ms ?? null,
        Number(rec.agent_invocations ?? 1),
        rec.cost_usd ?? null,
        Number(rec.retry_count ?? 0),
        rec.success == null ? null : (rec.success ? 1 : 0),
        rec.verification_coverage ?? null,
        stamp()
      );
      return id;
    },

    listContextMetrics(projectId = null, limit = 50) {
      const rows = projectId
        ? stmts.listContextByProject.all(projectId, limit)
        : stmts.listAllContext.all(limit);
      return rows.map(r => ({
        ...r,
        success: r.success == null ? null : Boolean(r.success)
      }));
    },

    recordUpdateEvent(rec) {
      const id = rec.id || `upd-${randomUUID().slice(0, 8)}`;
      stmts.addUpdateEvent.run(
        id,
        rec.from_version || null,
        rec.to_version || null,
        rec.from_commit || null,
        rec.to_commit || null,
        rec.action || 'update',
        rec.status || 'completed',
        rec.backup_path || null,
        JSON.stringify(rec.details || {}),
        stamp()
      );
      return id;
    },

    listUpdateHistory(limit = 30) {
      return stmts.listUpdateHistory.all(limit).map(r => ({
        ...r,
        details: safeJsonParse(r.details_json, {})
      }));
    },

    upsertImprovementProposal(rec) {
      const now = stamp();
      const id = rec.id || `imp-${randomUUID().slice(0, 8)}`;
      stmts.upsertImprovement.run(
        id,
        rec.category || 'routing',
        rec.title,
        rec.hypothesis,
        JSON.stringify(rec.evidence || {}),
        rec.status || 'proposed',
        rec.metrics_before ? JSON.stringify(rec.metrics_before) : null,
        rec.metrics_after ? JSON.stringify(rec.metrics_after) : null,
        rec.created_at || now,
        now
      );
      return id;
    },

    listImprovementProposals(status = null, limit = 50) {
      const rows = stmts.listImprovements.all(limit).map(r => ({
        ...r,
        evidence: safeJsonParse(r.evidence_json, {}),
        metrics_before: safeJsonParse(r.metrics_before_json, null),
        metrics_after: safeJsonParse(r.metrics_after_json, null)
      }));
      return status ? rows.filter(r => r.status === status) : rows;
    },

    recordDeploymentAdvice(rec) {
      const id = rec.id || `dep-${randomUUID().slice(0, 8)}`;
      stmts.addDeploymentAdvice.run(
        id,
        rec.project_id || null,
        rec.profile_id || null,
        rec.recommended_platform,
        JSON.stringify(rec.options || []),
        rec.plan_markdown || null,
        stamp()
      );
      return id;
    },

    listDeploymentAdvice(projectId = null, limit = 20) {
      const rows = projectId
        ? stmts.listDeploymentAdviceByProject.all(projectId, limit)
        : stmts.listAllDeploymentAdvice.all(limit);
      return rows.map(r => ({
        ...r,
        options: safeJsonParse(r.options_json, [])
      }));
    }
  };
}
