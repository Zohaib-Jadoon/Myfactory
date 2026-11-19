import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { inspectProjectStack } from './adapters.mjs';
import { AGENT_ROLES, PIPELINE_STAGES, executeAgentTask } from './agents.mjs';
import { runQualityGates } from './gates.mjs';

const stamp = () => new Date().toISOString();
const slug = s => String(s || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'task';

function readJson(p, fallback = null) {
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback;
}

function putJson(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const DONE_STATUSES = new Set(['completed', 'verified', 'approved']);

/** Write or update the per-project .factory/tasks/<id>.json mirror alongside SQLite. */
export function syncTaskFile(projectPath, task) {
  putJson(join(projectPath, '.factory', 'tasks', `${task.id}.json`), task);
}

/** Generate a dependency-aware multi-agent pipeline plan from a requirement/goal. */
export function createPipelinePlan({ db, project, goal, roles = null }) {
  const stack = inspectProjectStack(project.path);
  const pipeline = db.createPipeline(project.id, goal, 'planning', 'active');
  db.log(project.id, `[Director] Planning pipeline ${pipeline.id} for goal: ${goal}`, {
    pipelineId: pipeline.id,
    agentRole: 'director'
  });

  const requested = new Set(roles || []);
  const wantDb = requested.has('database') || stack.adapters.includes('postgres') || stack.adapters.includes('sqlserver') || /\b(sql|postgres|postgresql|database|schema|migration)\b/i.test(goal);
  const wantBackend = requested.has('backend') || stack.adapters.includes('nestjs') || stack.adapters.includes('node') || stack.adapters.includes('python') || stack.adapters.includes('dotnet') || /\b(api|backend|auth|service|rest|endpoint)\b/i.test(goal);
  const wantFrontend = requested.has('frontend') || stack.adapters.includes('nextjs') || stack.adapters.includes('react') || /\b(ui|ux|web|frontend|dashboard|page|react|nextjs|next\.js)\b/i.test(goal);
  const wantUiUx = requested.has('ui_ux') || wantFrontend || requested.has('mobile');
  const wantMobile = requested.has('mobile') || stack.adapters.includes('flutter') || stack.adapters.includes('expo') || /\b(mobile|android|ios|flutter|react native|expo)\b/i.test(goal);
  const wantAiMl = requested.has('ai_ml') || stack.adapters.includes('ai_ml') || /\b(ai|ml|model|llm|embedding|inference)\b/i.test(goal);

  const created = [];
  function addTask({ title, criteria, stage, agentRole, priority, dependsOn = [] }) {
    const id = `${slug(title)}-${randomUUID().slice(0, 6)}`;
    const task = db.saveTask(project.id, {
      id,
      pipeline_id: pipeline.id,
      title,
      criteria,
      stage,
      agent_role: agentRole,
      status: 'queued',
      priority,
      depends_on: dependsOn,
      attempts: 0,
      max_retries: 2
    });
    db.recordTaskEvent(project.id, id, 'created', 'director', `Stage ${stage} assigned to ${agentRole}`);
    syncTaskFile(project.path, task);
    created.push(task);
    return task;
  }

  const pm = addTask({
    title: 'Define PRD and acceptance criteria',
    criteria: `Goal: ${goal}. Output measurable acceptance criteria and non-functional constraints.`,
    stage: 'requirements',
    agentRole: 'product_manager',
    priority: 10
  });

  const arch = addTask({
    title: 'Design system architecture and boundaries',
    criteria: `Define components, API contracts, data boundaries, and minimal dependency plan for: ${goal}`,
    stage: 'architecture',
    agentRole: 'architect',
    priority: 20,
    dependsOn: [pm.id]
  });

  const archDeps = [arch.id];
  if (wantUiUx) {
    const ux = addTask({
      title: 'Specify UI/UX flows and accessibility',
      criteria: `Define responsive layout, WCAG 2.2 AA contrast, and loading/empty/error/success states for: ${goal}`,
      stage: 'architecture',
      agentRole: 'ui_ux',
      priority: 25,
      dependsOn: [pm.id]
    });
    archDeps.push(ux.id);
  }

  const implIds = [];
  if (wantDb) {
    const t = addTask({
      title: 'Design and migrate database schema',
      criteria: `Create schema, constraints, indexes, and rollback-safe migration tests for: ${goal}`,
      stage: 'implementation',
      agentRole: 'database',
      priority: 30,
      dependsOn: [arch.id]
    });
    implIds.push(t.id);
  }
  if (wantBackend || (!wantFrontend && !wantMobile && !wantDb && !wantAiMl)) {
    const t = addTask({
      title: 'Implement backend services and tests',
      criteria: `Implement API/business logic, validation, authz checks, and unit/integration tests for: ${goal}`,
      stage: 'implementation',
      agentRole: 'backend',
      priority: 35,
      dependsOn: wantDb ? [arch.id, implIds[0]] : [arch.id]
    });
    implIds.push(t.id);
  }
  if (wantFrontend) {
    const t = addTask({
      title: 'Implement frontend interface and tests',
      criteria: `Implement accessible responsive UI, validation, and component/E2E tests for: ${goal}`,
      stage: 'implementation',
      agentRole: 'frontend',
      priority: 40,
      dependsOn: archDeps
    });
    implIds.push(t.id);
  }
  if (wantMobile) {
    const t = addTask({
      title: 'Implement mobile application modules',
      criteria: `Implement mobile screens, offline/error states, and widget/unit tests for: ${goal}`,
      stage: 'implementation',
      agentRole: 'mobile',
      priority: 42,
      dependsOn: archDeps
    });
    implIds.push(t.id);
  }
  if (wantAiMl) {
    const t = addTask({
      title: 'Implement AI/ML service and evaluation',
      criteria: `Implement AI service boundaries, fallback handling, and reproducible evals for: ${goal}`,
      stage: 'implementation',
      agentRole: 'ai_ml',
      priority: 45,
      dependsOn: [arch.id]
    });
    implIds.push(t.id);
  }

  const qa = addTask({
    title: 'Run automated QA and quality gates',
    criteria: 'Execute lint, typecheck, unit/integration tests, and build validation with zero skipped assertions.',
    stage: 'testing',
    agentRole: 'qa',
    priority: 60,
    dependsOn: implIds
  });

  const sec = addTask({
    title: 'Run security and secret audit',
    criteria: 'Verify zero tracked or embedded secrets, safe path/input boundaries, and dependency risk status.',
    stage: 'security_review',
    agentRole: 'security',
    priority: 62,
    dependsOn: implIds
  });

  const rev = addTask({
    title: 'Run independent code review',
    criteria: 'Audit git diff hygiene, Ponytail minimal complexity, and adherence to acceptance criteria.',
    stage: 'quality_review',
    agentRole: 'code_review',
    priority: 64,
    dependsOn: implIds
  });

  const devops = addTask({
    title: 'Prepare reproducible build and rollback runbook',
    criteria: 'Document build commands, env var names only, health probes, and rollback steps.',
    stage: 'release_candidate',
    agentRole: 'devops',
    priority: 70,
    dependsOn: [qa.id, sec.id, rev.id]
  });

  addTask({
    title: 'Update documentation and release notes',
    criteria: 'Synchronize architecture, setup instructions, and execution status.',
    stage: 'verification',
    agentRole: 'documentation',
    priority: 80,
    dependsOn: [devops.id]
  });

  db.updatePipeline(pipeline.id, 'assignment', 'active');
  return { pipeline, tasks: created };
}

/** Check if all task dependencies are satisfied. */
function dependenciesMet(task, taskMap) {
  return (task.depends_on || []).every(depId => {
    const dep = taskMap.get(depId);
    return dep && DONE_STATUSES.has(dep.status);
  });
}

/**
 * Execute ready tasks in dependency order with bounded parallelism,
 * retries, lease tracking, and clean stop when IDE implementation is required.
 */
export async function runOrchestrator({ db, project, pipelineId = null, concurrency = 3, maxCycles = 25, onVerify }) {
  const executed = [];
  const workerId = `orch-${process.pid}`;

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const all = db.listTasks(project.id).filter(t => !pipelineId || t.pipeline_id === pipelineId);
    const taskMap = new Map(all.map(t => [t.id, t]));

    const ready = all.filter(t => t.status === 'queued' && dependenciesMet(t, taskMap));
    if (ready.length === 0) break;

    const batch = ready.slice(0, Math.max(1, concurrency));
    for (const t of batch) {
      t.status = 'running';
      t.attempts = (t.attempts || 0) + 1;
      t.lease_owner = workerId;
      t.lease_expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      db.saveTask(project.id, t);
      db.recordTaskEvent(project.id, t.id, 'started', workerId, `Attempt ${t.attempts}`);
      syncTaskFile(project.path, t);
    }

    const outcomes = await Promise.all(
      batch.map(async task => {
        const outcome = await executeAgentTask({ db, project, task, runGateFn: onVerify });
        return { task, outcome };
      })
    );

    for (const { task, outcome } of outcomes) {
      const fresh = db.getTask(task.id);
      if (fresh.status === 'cancelled') {
        executed.push({ id: task.id, status: 'cancelled', summary: 'Cancelled during execution' });
        continue;
      }

      if (outcome.status === 'completed') {
        fresh.status = 'completed';
        fresh.lease_owner = null;
        fresh.lease_expires_at = null;
        fresh.last_error = null;
        db.saveTask(project.id, fresh);
        db.recordTaskEvent(project.id, fresh.id, 'completed', fresh.agent_role, outcome.summary);
      } else if (outcome.status === 'awaiting_agent') {
        fresh.status = 'awaiting_agent';
        fresh.lease_owner = null;
        fresh.lease_expires_at = null;
        db.saveTask(project.id, fresh);
        db.recordTaskEvent(project.id, fresh.id, 'awaiting_agent', 'director', outcome.summary);
      } else if (outcome.status === 'blocked') {
        fresh.status = 'blocked';
        fresh.lease_owner = null;
        fresh.lease_expires_at = null;
        fresh.last_error = outcome.summary;
        db.saveTask(project.id, fresh);
        db.recordTaskEvent(project.id, fresh.id, 'blocked', fresh.agent_role, outcome.summary);
      } else {
        // Retry if attempts remain, otherwise mark failed
        fresh.lease_owner = null;
        fresh.lease_expires_at = null;
        fresh.last_error = outcome.summary;
        if (fresh.attempts < (fresh.max_retries ?? 2)) {
          fresh.status = 'queued';
          db.saveTask(project.id, fresh);
          db.recordTaskEvent(project.id, fresh.id, 'retry-queued', 'director', outcome.summary);
        } else {
          fresh.status = 'failed';
          db.saveTask(project.id, fresh);
          db.recordTaskEvent(project.id, fresh.id, 'failed', fresh.agent_role, outcome.summary);
        }
      }
      syncTaskFile(project.path, fresh);
      executed.push({ id: fresh.id, role: fresh.agent_role, status: fresh.status, summary: outcome.summary });
    }
  }

  const finalTasks = db.listTasks(project.id).filter(t => !pipelineId || t.pipeline_id === pipelineId);
  if (pipelineId) {
    const hasBlockedOrFailed = finalTasks.some(t => t.status === 'blocked' || t.status === 'failed');
    const allDone = finalTasks.length > 0 && finalTasks.every(t => DONE_STATUSES.has(t.status));
    const currentStage = allDone
      ? 'release_candidate'
      : (finalTasks.find(t => !DONE_STATUSES.has(t.status))?.stage || 'implementation');
    const status = hasBlockedOrFailed ? 'blocked' : (allDone ? 'ready_for_release' : 'paused');
    db.updatePipeline(pipelineId, currentStage, status);
  }

  return { executed, tasks: finalTasks };
}

/**
 * Resume interrupted or failed tasks without discarding completed work.
 * Resets `running` (crashed/interrupted) and `failed`/`blocked` (if retryable or forced) to `queued`.
 */
export function resumeTasks({ db, project, pipelineId = null, includeFailed = true }) {
  const tasks = db.listTasks(project.id).filter(t => !pipelineId || t.pipeline_id === pipelineId);
  const resumed = [];
  for (const t of tasks) {
    if (DONE_STATUSES.has(t.status) || t.status === 'cancelled') continue;
    if (t.status === 'running' || (includeFailed && (t.status === 'failed' || t.status === 'blocked'))) {
      const prev = t.status;
      t.status = 'queued';
      t.lease_owner = null;
      t.lease_expires_at = null;
      if (t.attempts >= (t.max_retries ?? 2)) t.max_retries = t.attempts + 1;
      db.saveTask(project.id, t);
      db.recordTaskEvent(project.id, t.id, 'resumed', 'director', `Recovered from ${prev}`);
      syncTaskFile(project.path, t);
      resumed.push({ id: t.id, from: prev, to: 'queued' });
    }
  }
  if (pipelineId && resumed.length > 0) {
    db.updatePipeline(pipelineId, 'implementation', 'active');
  }
  db.log(project.id, `[Director] Resumed ${resumed.length} interrupted/failed task(s); preserved completed tasks.`, {
    pipelineId,
    agentRole: 'director'
  });
  return resumed;
}

export function cancelTask({ db, project, taskId, reason = 'Cancelled by operator' }) {
  const t = db.getTask(taskId);
  if (!t) throw new Error(`Unknown task: ${taskId}`);
  t.status = 'cancelled';
  t.lease_owner = null;
  t.lease_expires_at = null;
  t.last_error = reason;
  db.saveTask(project.id, t);
  db.recordTaskEvent(project.id, t.id, 'cancelled', 'operator', reason);
  syncTaskFile(project.path, t);
  db.log(project.id, `[Director] Cancelled task ${taskId}: ${reason}`, { taskId, agentRole: 'director', level: 'warn' });
  return t;
}

/** Merge a verified, clean worktree branch into the current repository branch. Never pushes. */
export function integrateWorktree({ db, project, taskId }) {
  const t = db.getTask(taskId);
  if (!t) throw new Error(`Unknown task: ${taskId}`);
  if (!t.branch || !t.worktree) throw new Error(`Task ${taskId} has no isolated worktree branch`);
  if (!t.verification?.ok) throw new Error(`Task ${taskId} has not passed verification; cannot integrate`);
  const workDirty = git(t.worktree, ['status', '--porcelain']);
  if (workDirty) throw new Error(`Worktree ${t.worktree} has uncommitted changes`);
  const rootDirty = git(project.path, ['status', '--porcelain']);
  if (rootDirty) throw new Error(`Root repo ${project.path} has uncommitted changes; commit or stash first`);

  git(project.path, ['merge', '--no-ff', '--no-edit', t.branch]);
  const newHead = git(project.path, ['rev-parse', 'HEAD']);
  db.recordTaskEvent(project.id, t.id, 'integrated', 'director', `Merged ${t.branch} -> ${newHead}`);
  db.log(project.id, `[Director] Integrated verified branch ${t.branch} at ${newHead}`, { taskId, agentRole: 'director' });
  return { taskId, branch: t.branch, head: newHead };
}

/**
 * Prepare a Release Candidate: evaluates fresh gates, security findings, and clean git HEAD.
 * Blocks release if any required check fails or returns NOT VERIFIED.
 */
export function prepareReleaseCandidate({ db, project, version = '0.1.0-rc.1', notes = '', rollbackPlan = '', taskId = null }) {
  const report = runQualityGates({
    projectPath: project.path,
    task: taskId ? db.getTask(taskId) : null,
    db,
    projectId: project.id
  });
  const openSec = db.listSecurityFindings(project.id, 100).filter(
    f => f.status === 'open' && (f.severity === 'critical' || f.severity === 'high')
  );
  const blocked = !report.ok || report.dirty || openSec.length > 0;
  const reasons = [];
  if (!report.ok) reasons.push(`Failed/unverified gates: ${report.results.filter(r => !r.ok).map(r => `${r.name}(${r.status})`).join(', ')}`);
  if (report.dirty) reasons.push('Working tree has uncommitted changes');
  if (openSec.length > 0) reasons.push(`${openSec.length} open critical/high security finding(s)`);

  const status = blocked ? 'blocked' : 'pending_approval';
  const defaultRollback = rollbackPlan || `git revert ${report.revision || 'HEAD'} && rerun factory verify`;
  const releaseId = db.createRelease(project.id, {
    taskId,
    version,
    revision: report.revision,
    gateRunId: report.gate_run_id,
    status,
    notes: notes || (blocked ? `BLOCKED: ${reasons.join('; ')}` : `Release candidate verified at ${report.revision || 'workspace'}`),
    rollbackPlan: defaultRollback
  });

  let approvalId = null;
  if (!blocked) {
    approvalId = db.requestApproval(project.id, {
      taskId,
      releaseId,
      action: `Approve release candidate ${version} (manual deployment only)`,
      requestedBy: 'devops',
      revision: report.revision
    });
  }

  db.log(project.id, `[Release] ${version} status=${status}${reasons.length ? ` (${reasons.join('; ')})` : ''}`, {
    taskId,
    agentRole: 'devops',
    level: blocked ? 'warn' : 'info'
  });

  return {
    ok: !blocked,
    releaseId,
    approvalId,
    status,
    version,
    revision: report.revision,
    reasons,
    report
  };
}

export { AGENT_ROLES, PIPELINE_STAGES };
