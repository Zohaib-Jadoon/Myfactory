#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, realpathSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openFactoryDb, defaultDbPath, projectIdForPath } from '../src/db.mjs';
import { inspectProjectStack, detectRuntimes } from '../src/adapters.mjs';
import { enforceSafetyPolicy, redactSecrets } from '../src/security.mjs';
import { AGENT_ROLES, detectProviders, executeAgentTask } from '../src/agents.mjs';
import { hashProjectConfig, runQualityGates } from '../src/gates.mjs';
import {
  cancelTask,
  createPipelinePlan,
  integrateWorktree,
  prepareReleaseCandidate,
  resumeTasks,
  runOrchestrator,
  syncTaskFile
} from '../src/orchestrator.mjs';
import { startDashboardServer } from '../src/dashboard.mjs';

export const VERSION = '0.2.0';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const asPath = p => resolve(p || process.cwd());
const store = p => join(p, '.factory');
const taskPath = (p, id) => join(store(p), 'tasks', `${id}.json`);
const must = (b, msg) => { if (!b) throw new Error(msg); };
const readJson = (p, fallback) => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback;
const putJson = (p, obj) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8'); };
const stamp = () => new Date().toISOString();
const git = (p, args) => execFileSync('git', args, { cwd: p, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'task';

function resolveDbPath(projectPath) {
  if (process.env.FACTORY_DB_PATH) return resolve(process.env.FACTORY_DB_PATH);
  const runningInNodeTest = process.execArgv.some(a => a.includes('test')) || Boolean(process.env.NODE_TEST_CONTEXT);
  if (runningInNodeTest && projectPath) return join(asPath(projectPath), '.factory', 'factory.db');
  return defaultDbPath();
}

function withDb(projectPath, fn) {
  const db = openFactoryDb(resolveDbPath(projectPath));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function withDbAsync(projectPath, fn) {
  const db = openFactoryDb(resolveDbPath(projectPath));
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

function requireInit(p) {
  must(existsSync(join(store(p), 'config.json')), `Not initialized: ${p}. Run factory init "${p}"`);
}

function syncProjectRecord(db, p) {
  const cfgPath = join(store(p), 'config.json');
  const rawCfg = readJson(cfgPath, {});
  const cfg = enforceSafetyPolicy(rawCfg);
  const stack = inspectProjectStack(p, { includeRuntimes: false });
  const adapters = Array.isArray(cfg.adapters) && cfg.adapters.length ? cfg.adapters : stack.adapters;
  return db.upsertProject({
    name: cfg.name || basename(p),
    path: p,
    adapterIds: adapters,
    config: cfg,
    configHash: hashProjectConfig(p)
  });
}

function syncTasksFromDisk(db, project) {
  const dir = join(store(project.path), 'tasks');
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const t = readJson(join(dir, file), null);
    if (!t || !t.id) continue;
    if (!db.getTask(t.id)) {
      db.saveTask(project.id, t);
      for (const h of t.history || []) {
        db.recordTaskEvent(project.id, t.id, h.event || 'synced', h.actor || null, h.detail || null);
      }
    }
  }
}

function readTask(p, id) {
  requireInit(p);
  const f = taskPath(p, id);
  if (existsSync(f)) return readJson(f);
  const fromDb = withDb(p, db => db.getTask(id));
  must(fromDb, `Unknown task: ${id}`);
  writeTask(p, fromDb);
  return fromDb;
}

function writeTask(p, t) {
  t.updated_at = stamp();
  putJson(taskPath(p, t.id), t);
}

export function detectChecks(p) {
  return inspectProjectStack(asPath(p)).required_checks;
}

function copyMissingTree(srcDir, destDir, created = []) {
  if (!existsSync(srcDir)) return created;
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyMissingTree(srcPath, dstPath, created);
    } else if (entry.isFile() && !existsSync(dstPath)) {
      copyFileSync(srcPath, dstPath);
      created.push(dstPath);
    }
  }
  return created;
}

export function init(p, opts = {}) {
  p = asPath(p);
  must(existsSync(p), `Project path does not exist: ${p}`);
  const conf = join(store(p), 'config.json');
  const stack = inspectProjectStack(p);
  const freshInit = !existsSync(conf);
  if (freshInit) {
    putJson(conf, {
      schema: 2,
      name: opts.name || basename(p),
      created_at: stamp(),
      adapters: stack.adapters,
      required_checks: stack.required_checks,
      human_approval_required: true,
      automatic_deployment: false,
      quality_targets: {
        acceptance_pass_rate_min: 100,
        unit_integration_pass_rate_min: 100,
        critical_high_security_findings_max: 0
      }
    });
  }
  mkdirSync(join(store(p), 'tasks'), { recursive: true });
  mkdirSync(join(store(p), 'reports'), { recursive: true });
  const ig = join(store(p), '.gitignore');
  if (!existsSync(ig)) writeFileSync(ig, '*\n', 'utf8');

  const scaffolded = [];
  if (opts.full) {
    copyMissingTree(join(ROOT, '.agent'), join(p, '.agent'), scaffolded);
    copyMissingTree(join(ROOT, '.agents'), join(p, '.agents'), scaffolded);
    copyMissingTree(join(ROOT, '.cursor', 'rules'), join(p, '.cursor', 'rules'), scaffolded);
    copyMissingTree(join(ROOT, '.agents', 'skills'), join(p, '.cursor', 'skills'), scaffolded);
  }

  const config = readJson(conf);
  withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    if (freshInit && readdirSync(join(store(p), 'tasks')).length === 0) {
      db.resetProjectTasks(proj.id);
    } else {
      syncTasksFromDisk(db, proj);
    }
    db.log(proj.id, `Initialized project ${proj.name} (adapters: ${stack.adapters.join(', ') || 'generic'})`, { agentRole: 'director' });
  });
  return { project: p, adapters: stack.adapters, runtimes: stack.runtimes, config, scaffolded_count: scaffolded.length };
}

export function create(p, title, criteria = '', opts = {}) {
  p = asPath(p);
  requireInit(p);
  must(typeof title === 'string' && title.trim(), 'A task title is required');
  const id = `${slug(title)}-${randomUUID().slice(0, 8)}`;
  const t = {
    id,
    title: title.trim(),
    criteria: criteria || 'Needs measurable acceptance criteria before implementation',
    stage: opts.stage || 'implementation',
    agent_role: opts.role || 'backend',
    status: 'queued',
    priority: opts.priority ?? 50,
    depends_on: opts.depends_on || [],
    attempts: 0,
    max_retries: 2,
    created_at: stamp(),
    updated_at: stamp(),
    branch: null,
    worktree: null,
    verification: null,
    approval: null,
    history: [{ at: stamp(), event: 'created' }]
  };
  writeTask(p, t);
  const prompt = `# Task: ${t.title}\n\nTask ID: ${t.id}\nProject: ${p}\nAgent Role: ${t.agent_role}\n\n## Acceptance criteria\n${t.criteria}\n\n## Instructions for Antigravity / Cursor IDE\nActivate /factory-build and /poteto-mode (if installed). Apply Ponytail minimal complete diff principles. Inspect code before planning; cover API, frontend, database, mobile, migrations, tests and observability as applicable. Work in the worktree recorded by this task. Run: factory verify "${p}" --id "${id}" (or node "${join(ROOT, 'bin', 'factory.mjs')}" verify "${p}" --id "${id}"). Do not deploy or merge without explicit approval.\n`;
  writeFileSync(join(store(p), 'tasks', `${id}.md`), prompt, 'utf8');

  withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    db.saveTask(proj.id, t);
    db.recordTaskEvent(proj.id, t.id, 'created', 'operator', t.title);
    db.log(proj.id, `Created task ${t.id}: ${t.title}`, { taskId: t.id, agentRole: t.agent_role });
  });
  return t;
}

export function list(p) {
  p = asPath(p);
  requireInit(p);
  return readdirSync(join(store(p), 'tasks'))
    .filter(x => x.endsWith('.json'))
    .map(x => readJson(join(store(p), 'tasks', x)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function makeWorktree(p, id) {
  p = asPath(p);
  const t = readTask(p, id);
  must(!t.worktree, 'Task already has worktree');
  must(existsSync(join(p, '.git')) || git(p, ['rev-parse', '--is-inside-work-tree']) === 'true', 'Project must be a Git repository');
  const root = git(p, ['rev-parse', '--show-toplevel']);
  const normReal = x => {
    const r = typeof realpathSync.native === 'function' ? realpathSync.native(resolve(x)) : realpathSync(resolve(x));
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  must(normReal(root) === normReal(p), 'Use the repository root as project path');
  const branch = `factory/${id}`;
  const destination = join(store(p), 'worktrees', id);
  mkdirSync(dirname(destination), { recursive: true });
  git(p, ['worktree', 'add', '-b', branch, destination, 'HEAD']);
  t.branch = branch;
  t.worktree = destination;
  t.status = 'planning';
  t.history.push({ at: stamp(), event: 'worktree-created' });
  writeTask(p, t);

  mkdirSync(join(store(destination), 'tasks'), { recursive: true });
  mkdirSync(join(store(destination), 'reports'), { recursive: true });
  putJson(join(store(destination), 'config.json'), readJson(join(store(p), 'config.json')));
  writeFileSync(join(store(destination), '.gitignore'), '*\n', 'utf8');

  withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    db.saveTask(proj.id, t);
    db.recordTaskEvent(proj.id, t.id, 'worktree-created', 'director', destination);
    db.log(proj.id, `Created isolated worktree for ${t.id} at ${destination}`, { taskId: t.id, agentRole: t.agent_role || 'director' });
  });
  return t;
}

export function verify(p, id) {
  p = asPath(p);
  requireInit(p);
  const t = id ? readTask(p, id) : null;

  return withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    syncTasksFromDisk(db, proj);
    const report = runQualityGates({ projectPath: p, task: t, db, projectId: proj.id });

    if (t) {
      t.verification = {
        at: report.at,
        ok: report.ok,
        report: report.reportPath,
        revision: report.revision,
        dirty: report.dirty,
        config_hash: report.config_hash,
        metrics: report.metrics
      };
      t.status = report.ok ? 'verified' : 'blocked';
      if (!report.ok) {
        t.last_error = report.results.filter(r => !r.ok).map(r => `${r.name}: ${r.status}`).join(', ');
      } else {
        t.last_error = null;
      }
      t.history.push({ at: stamp(), event: report.ok ? 'verified' : 'verification-failed' });
      writeTask(p, t);
      db.saveTask(proj.id, t);
      db.recordTaskEvent(proj.id, t.id, report.ok ? 'verified' : 'verification-failed', 'qa', `pass_rate=${report.metrics.gate_pass_rate}%`);
    }

    db.log(proj.id, `Verification ${report.ok ? 'PASSED' : 'BLOCKED'} (${report.metrics.passed_gates}/${report.metrics.total_gates} gates)`, {
      taskId: id || null,
      agentRole: 'qa',
      level: report.ok ? 'info' : 'warn'
    });
    return report;
  });
}

export function approve(p, id, by, opts = {}) {
  p = asPath(p);
  must(by && by.trim(), 'Approver required');
  const t = readTask(p, id);
  must(t.status === 'verified' && t.verification?.ok, 'Cannot approve a task that has not passed verification');
  must(!t.verification.dirty, 'Cannot approve dirty source: commit, rerun checks then approve');
  must(t.verification.config_hash === hashProjectConfig(p), 'Factory gate configuration changed after verification: rerun checks');
  let head;
  try {
    head = git(t.worktree || p, ['rev-parse', 'HEAD']);
  } catch {
    throw new Error('Git revision unavailable: cannot approve');
  }
  must(head === t.verification.revision, 'HEAD changed after verification: rerun checks');
  const dirt = git(t.worktree || p, ['status', '--porcelain']);
  must(!dirt, 'Uncommitted changes: commit and rerun checks');
  t.approval = { by, at: stamp(), revision: head };
  t.status = 'approved';
  t.history.push({ at: stamp(), event: 'approved', by });
  writeTask(p, t);

  withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    db.saveTask(proj.id, t);
    db.recordTaskEvent(proj.id, t.id, 'approved', by, `Approved clean revision ${head}`);
    if (opts.releaseId) {
      db.approveRelease(opts.releaseId, by);
    }
    const pending = db.listApprovals(proj.id, 50).filter(a => a.status === 'pending' && (a.task_id === id || (opts.releaseId && a.release_id === opts.releaseId)));
    for (const apr of pending) {
      db.decideApproval(apr.id, { status: 'approved', decidedBy: by, reason: `Verified HEAD ${head}` });
    }
    db.log(proj.id, `Human approval recorded by ${by} for ${id} at ${head}`, { taskId: id, agentRole: 'director' });
  });
  return t;
}

export function serve(p, port = 4177) {
  p = asPath(p);
  requireInit(p);
  const dbPath = resolveDbPath(p);
  withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    syncTasksFromDisk(db, proj);
  });
  return startDashboardServer({ dbPath, openDbFn: openFactoryDb, projectPath: p, port, version: VERSION });
}

export function doctor(p) {
  p = asPath(p);
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const globalSkills = join(home, '.gemini', 'config', 'skills');
  const globalWorkflows = join(home, '.gemini', 'workflows');
  const cursorSkillsDir = join(home, '.cursor', 'skills');
  const cursorRuleFile = join(home, '.cursor', 'rules', 'factory-quality.mdc');
  const skills = existsSync(globalSkills) ? readdirSync(globalSkills).filter(d => existsSync(join(globalSkills, d, 'SKILL.md'))) : [];
  const cursorInstalled = existsSync(cursorSkillsDir) ? readdirSync(cursorSkillsDir).filter(d => existsSync(join(cursorSkillsDir, d, 'SKILL.md'))) : [];
  const workflows = existsSync(globalWorkflows) ? readdirSync(globalWorkflows).filter(f => f.endsWith('.md')) : [];
  const expectedSkills = [
    'factory-init', 'factory-plan', 'factory-build', 'factory-status',
    'factory-test', 'factory-review', 'factory-fix', 'factory-release',
    'factory-resume', 'factory-verify', 'factory-security',
    'poteto-mode', 'ponytail'
  ];
  const present = expectedSkills.map(k => ({ skill: k, installed_globally: skills.includes(k) }));
  const cursorSkills = expectedSkills.map(k => ({ skill: k, installed_globally: cursorInstalled.includes(k) }));
  let gitVersion = null;
  try { gitVersion = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(); } catch {}

  const dbPath = resolveDbPath(p);
  let sqliteOk = false;
  try {
    const db = openFactoryDb(dbPath);
    sqliteOk = true;
    db.close();
  } catch {}

  return {
    version: VERSION,
    node: process.version,
    sqlite_ok: sqliteOk,
    db_path: dbPath,
    git: gitVersion,
    project: p,
    initialized: existsSync(join(store(p), 'config.json')),
    adapters: existsSync(p) ? inspectProjectStack(p).adapters : [],
    runtimes: detectRuntimes(),
    providers: detectProviders(),
    global_skill_path: globalSkills,
    global_workflow_path: globalWorkflows,
    installed_workflow_count: workflows.length,
    skills: present,
    cursor_skill_path: cursorSkillsDir,
    cursor_rule_installed: existsSync(cursorRuleFile),
    cursor_skills: cursorSkills
  };
}

export function plan(p, goal, opts = {}) {
  p = asPath(p);
  requireInit(p);
  must(goal && goal.trim(), 'A goal description is required (--goal "...")');
  return withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    const roles = opts.roles ? opts.roles.split(',').map(s => s.trim()).filter(Boolean) : null;
    return createPipelinePlan({ db, project: proj, goal: goal.trim(), roles });
  });
}

export async function run(p, opts = {}) {
  p = asPath(p);
  requireInit(p);
  return withDbAsync(p, async db => {
    const proj = syncProjectRecord(db, p);
    syncTasksFromDisk(db, proj);
    const res = await runOrchestrator({
      db,
      project: proj,
      pipelineId: opts.pipeline || null,
      concurrency: Number(opts.concurrency || 3),
      onVerify: (projPath, taskId) => {
        const t = taskId ? db.getTask(taskId) : null;
        return runQualityGates({ projectPath: projPath, task: t, db, projectId: proj.id });
      }
    });
    return res;
  });
}

export function status(p) {
  p = asPath(p);
  requireInit(p);
  return withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    syncTasksFromDisk(db, proj);
    const tasks = db.listTasks(proj.id);
    const pipelines = db.listPipelines(proj.id);
    const gates = db.listGateRuns(proj.id, 5);
    const security = db.listSecurityFindings(proj.id, 20);
    const releases = db.listReleases(proj.id, 10);
    const approvals = db.listApprovals(proj.id, 20);
    return {
      project: { id: proj.id, name: proj.name, path: proj.path, adapters: proj.adapter_ids },
      pipelines,
      summary: {
        total: tasks.length,
        queued: tasks.filter(t => t.status === 'queued').length,
        running: tasks.filter(t => t.status === 'running').length,
        awaiting_agent: tasks.filter(t => t.status === 'awaiting_agent').length,
        completed: tasks.filter(t => ['completed', 'verified', 'approved'].includes(t.status)).length,
        blocked: tasks.filter(t => t.status === 'blocked').length,
        failed: tasks.filter(t => t.status === 'failed').length
      },
      tasks,
      latest_gate: gates[0] || null,
      open_security_findings: security.filter(f => f.status === 'open'),
      releases,
      pending_approvals: approvals.filter(a => a.status === 'pending')
    };
  });
}

export async function review(p, id = null) {
  p = asPath(p);
  requireInit(p);
  return withDbAsync(p, async db => {
    const proj = syncProjectRecord(db, p);
    const task = id ? db.getTask(id) : { id: `review-${randomUUID().slice(0, 6)}`, title: 'Independent Security & Code Review', criteria: 'Audit repository security and diff hygiene', agent_role: 'code_review' };
    const secOutcome = await executeAgentTask({ db, project: proj, task: { ...task, agent_role: 'security' }, runGateFn: () => verify(p, id) });
    const revOutcome = await executeAgentTask({ db, project: proj, task: { ...task, agent_role: 'code_review' }, runGateFn: () => verify(p, id) });
    return {
      ok: secOutcome.status === 'completed' && revOutcome.status === 'completed',
      security: secOutcome,
      code_review: revOutcome
    };
  });
}

export function fix(p, id = null, opts = {}) {
  p = asPath(p);
  requireInit(p);
  return withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    syncTasksFromDisk(db, proj);
    const tasks = db.listTasks(proj.id);
    const targets = id
      ? tasks.filter(t => t.id === id)
      : tasks.filter(t => t.status === 'blocked' || t.status === 'failed');
    const gates = db.listGateRuns(proj.id, 3);
    const openSec = db.listSecurityFindings(proj.id, 30).filter(f => f.status === 'open');
    const openRev = db.listReviewFindings(proj.id, 30).filter(r => r.status === 'open');

    let retried = [];
    if (opts.retry) {
      retried = resumeTasks({ db, project: proj, includeFailed: true });
    }

    return {
      project: proj.path,
      failing_tasks: targets,
      latest_failed_gates: gates.filter(g => !g.ok),
      open_security_findings: openSec,
      open_review_findings: openRev,
      retried
    };
  });
}

export function release(p, opts = {}) {
  p = asPath(p);
  requireInit(p);
  return withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    syncTasksFromDisk(db, proj);
    return prepareReleaseCandidate({
      db,
      project: proj,
      version: opts.version || '0.1.0-rc.1',
      notes: opts.notes || '',
      rollbackPlan: opts.rollback || '',
      taskId: opts.id || null
    });
  });
}

export function resume(p, opts = {}) {
  p = asPath(p);
  requireInit(p);
  return withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    syncTasksFromDisk(db, proj);
    const recovered = resumeTasks({ db, project: proj, pipelineId: opts.pipeline || null, includeFailed: true });
    return { project: proj.path, recovered, tasks: db.listTasks(proj.id) };
  });
}

function help() {
  return `Universal Software Factory v${VERSION}

Usage:
  node bin/factory.mjs doctor [project]
  node bin/factory.mjs init [project] [--name "Project"] [--factory-only]
  node bin/factory.mjs plan [project] --goal "Requirements..." [--roles backend,frontend,database]
  node bin/factory.mjs create [project] --name "Task" --criteria "Outcome" [--role backend]
  node bin/factory.mjs run [project] [--pipeline ID] [--concurrency 3]
  node bin/factory.mjs status [project]
  node bin/factory.mjs list [project]
  node bin/factory.mjs worktree [project] --id TASK_ID
  node bin/factory.mjs integrate [project] --id TASK_ID
  node bin/factory.mjs verify [project] [--id TASK_ID]
  node bin/factory.mjs review [project] [--id TASK_ID]
  node bin/factory.mjs fix [project] [--id TASK_ID] [--retry]
  node bin/factory.mjs release [project] --version "0.1.0-rc.1" [--id TASK_ID]
  node bin/factory.mjs approve [project] --id TASK_ID --by "Owner" [--release REL_ID]
  node bin/factory.mjs resume [project] [--pipeline ID]
  node bin/factory.mjs cancel [project] --id TASK_ID [--reason "..."]
  node bin/factory.mjs logs [project] [--limit 50]
  node bin/factory.mjs agents
  node bin/factory.mjs serve [project] [--port 4177]

No automatic push, merge or deployment commands.
`;
}

function arg(args, key) {
  const i = args.indexOf(`--${key}`);
  return i < 0 || i + 1 >= args.length ? null : args[i + 1];
}

function hasFlag(args, key) {
  return args.includes(`--${key}`);
}

const executed = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (executed) {
  (async () => {
    try {
      const [command, ...args] = process.argv.slice(2);
      const p = args[0] && !args[0].startsWith('--') ? args[0] : process.cwd();
      let output;
      switch (command) {
        case 'init': output = init(p, { name: arg(args, 'name'), full: !hasFlag(args, 'factory-only') }); break;
        case 'doctor': output = doctor(p); break;
        case 'plan': output = plan(p, arg(args, 'goal'), { roles: arg(args, 'roles') }); break;
        case 'create': output = create(p, arg(args, 'name'), arg(args, 'criteria'), { role: arg(args, 'role') || 'backend', stage: arg(args, 'stage') || 'implementation', priority: Number(arg(args, 'priority') || 50) }); break;
        case 'run': case 'orchestrate': output = await run(p, { pipeline: arg(args, 'pipeline'), concurrency: arg(args, 'concurrency') }); break;
        case 'status': output = status(p); break;
        case 'list': output = list(p); break;
        case 'worktree': output = makeWorktree(p, arg(args, 'id')); break;
        case 'integrate': output = withDb(asPath(p), db => integrateWorktree({ db, project: syncProjectRecord(db, asPath(p)), taskId: arg(args, 'id') })); break;
        case 'verify': case 'test': output = verify(p, arg(args, 'id')); break;
        case 'review': output = await review(p, arg(args, 'id')); break;
        case 'fix': output = fix(p, arg(args, 'id'), { retry: hasFlag(args, 'retry') }); break;
        case 'release': output = release(p, { version: arg(args, 'version'), notes: arg(args, 'notes'), rollback: arg(args, 'rollback'), id: arg(args, 'id') }); break;
        case 'approve': output = approve(p, arg(args, 'id'), arg(args, 'by'), { releaseId: arg(args, 'release') }); break;
        case 'resume': output = resume(p, { pipeline: arg(args, 'pipeline') }); break;
        case 'cancel': output = withDb(asPath(p), db => cancelTask({ db, project: syncProjectRecord(db, asPath(p)), taskId: arg(args, 'id'), reason: arg(args, 'reason') || 'Cancelled by operator' })); break;
        case 'logs': output = withDb(asPath(p), db => db.listLogs(projectIdForPath(asPath(p)), Number(arg(args, 'limit') || 50))); break;
        case 'agents': output = Object.values(AGENT_ROLES); break;
        case 'serve': {
          const port = Number(arg(args, 'port') || 4177);
          serve(p, port);
          console.log(`Local dashboard: http://127.0.0.1:${port} (project: ${asPath(p)})`);
          break;
        }
        case 'help': case '--help': case undefined: console.log(help()); break;
        default: throw new Error(`Unknown command: ${command}\n${help()}`);
      }
      if (output) console.log(redactSecrets(JSON.stringify(output, null, 2)));
      if ((command === 'verify' || command === 'test' || command === 'release' || command === 'review') && output && output.ok === false) {
        process.exitCode = 1;
      }
    } catch (e) {
      console.error('ERROR:', redactSecrets(e.message));
      process.exitCode = 1;
    }
  })();
}
