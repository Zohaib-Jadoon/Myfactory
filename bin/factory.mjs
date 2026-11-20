#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, realpathSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openFactoryDb, defaultDbPath, defaultGlobalHome, defaultGlobalMemoryDbPath, projectIdForPath } from '../src/db.mjs';
import { CURRENT_SCHEMA_VERSION } from '../src/migrations.mjs';
import { inspectProjectStack, detectRuntimes } from '../src/adapters.mjs';
import { PROJECT_PROFILES, detectProjectProfile, normalizeProfileId } from '../src/profiles.mjs';
import { enforceSafetyPolicy, redactSecrets } from '../src/security.mjs';
import { AGENT_ROLES, detectProviders, executeAgentTask } from '../src/agents.mjs';
import { AGENT_CATEGORIES, SPECIALIST_AGENTS, validateAgentDefinitions } from '../src/agent-registry.mjs';
import { selectSpecialists, explainSelection } from '../src/router.mjs';
import { hashProjectConfig, runQualityGates } from '../src/gates.mjs';
import {
  cancelTask,
  createPipelinePlan,
  integrateWorktree,
  prepareReleaseCandidate,
  resumeTasks,
  runOrchestrator
} from '../src/orchestrator.mjs';
import { startDashboardServer } from '../src/dashboard.mjs';
import {
  openGlobalMemoryDb,
  learnFromProject,
  recordMemory,
  approveMemory,
  rejectMemory,
  disableMemory,
  deleteMemory,
  consolidateMemories,
  retrieveRelevantMemories,
  syncProjectMemoryViews,
  syncGlobalMemoryViews,
  exportMemories,
  importMemories
} from '../src/memory.mjs';
import { proposeImprovements } from '../src/improvement.mjs';
import { buildTaskContext, runContextBenchmark } from '../src/context-engine.mjs';
import {
  searchSkills,
  recommendSkills,
  inspectSkillSecurity,
  installSkill,
  listSkills,
  checkSkills,
  updateSkills,
  removeSkill
} from '../src/skills-engine.mjs';
import { adviseDeployment, generateDeploymentPlan } from '../src/deployment-advisor.mjs';
import { updateFactory, syncProject } from '../src/updater.mjs';

export const VERSION = '1.0.0';
export const PSTACK_REPO = 'https://github.com/backnotprop/pstack.git';
export const PONYTAIL_REPO = 'https://github.com/DietrichGebert/ponytail.git';
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
const isTestEnv = () => process.execArgv.some(a => a.includes('test')) || Boolean(process.env.NODE_TEST_CONTEXT);

function resolveDbPath(projectPath) {
  if (process.env.FACTORY_DB_PATH) return resolve(process.env.FACTORY_DB_PATH);
  if (isTestEnv() && projectPath) return join(asPath(projectPath), '.factory', 'factory.db');
  return defaultDbPath();
}

function resolveGlobalHomeDir(projectPath = null) {
  if (process.env.FACTORY_GLOBAL_HOME) return resolve(process.env.FACTORY_GLOBAL_HOME);
  if (isTestEnv() && projectPath) return join(asPath(projectPath), '.factory', 'global-test');
  return defaultGlobalHome();
}

function resolveGlobalMemoryDb(projectPath = null) {
  if (process.env.FACTORY_GLOBAL_MEMORY_DB) return openFactoryDb(process.env.FACTORY_GLOBAL_MEMORY_DB);
  return openGlobalMemoryDb(resolveGlobalHomeDir(projectPath));
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

export function copySkillDirs(skillsRoot, destRoot, created = []) {
  if (!existsSync(skillsRoot)) return created;
  mkdirSync(destRoot, { recursive: true });
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const srcSkill = join(skillsRoot, entry.name);
    if (existsSync(join(srcSkill, 'SKILL.md'))) {
      copyMissingTree(srcSkill, join(destRoot, entry.name), created);
    }
  }
  return created;
}

export function ensureExternalSkills({ skillTargets = [], agentTargets = [], skip = false } = {}) {
  if (skip) return { skipped: true, installed: [], warnings: [] };
  const missingPstack = skillTargets.filter(t => !existsSync(join(t, 'poteto-mode', 'SKILL.md')));
  const missingPstackAgents = agentTargets.filter(a => !existsSync(join(a, 'poteto-agent.md')));
  const missingPonytail = skillTargets.filter(t => !existsSync(join(t, 'ponytail', 'SKILL.md')));
  if (missingPstack.length === 0 && missingPstackAgents.length === 0 && missingPonytail.length === 0) {
    return { skipped: false, installed: [], warnings: [] };
  }

  const installed = [];
  const warnings = [];
  const pkgs = [];
  if (missingPstack.length > 0 || missingPstackAgents.length > 0) {
    pkgs.push({ name: 'pstack', repo: PSTACK_REPO, targets: missingPstack, agents: missingPstackAgents });
  }
  if (missingPonytail.length > 0) pkgs.push({ name: 'ponytail', repo: PONYTAIL_REPO, targets: missingPonytail, agents: [] });

  for (const pkg of pkgs) {
    const tmp = mkdtempSync(join(tmpdir(), 'factory-ext-'));
    try {
      execFileSync('git', ['clone', '--quiet', '--depth', '1', pkg.repo, tmp], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      for (const target of pkg.targets) {
        copySkillDirs(join(tmp, 'skills'), target);
      }
      if (pkg.agents.length > 0 && existsSync(join(tmp, 'agents'))) {
        for (const agentDir of pkg.agents) {
          mkdirSync(agentDir, { recursive: true });
          for (const entry of readdirSync(join(tmp, 'agents'), { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.md')) {
              const dst = join(agentDir, entry.name);
              if (!existsSync(dst)) copyFileSync(join(tmp, 'agents', entry.name), dst);
            }
          }
        }
      }
      installed.push(pkg.name);
    } catch (err) {
      warnings.push(`Could not auto-install ${pkg.name} from ${pkg.repo}: ${err.message}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return { skipped: false, installed, warnings };
}

function scaffoldWorkspaceFiles(srcRoot, p, profileId, adapters, scaffolded) {
  // Top-level .agent docs (never copy master 60-file .agent/agents catalog into individual repos)
  const srcAgentDir = join(srcRoot, '.agent');
  if (existsSync(srcAgentDir)) {
    mkdirSync(join(p, '.agent'), { recursive: true });
    for (const entry of readdirSync(srcAgentDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        const dst = join(p, '.agent', entry.name);
        if (!existsSync(dst)) {
          copyFileSync(join(srcAgentDir, entry.name), dst);
          scaffolded.push(dst);
        }
      }
    }
  }

  // Always copy workflows and generated Antigravity/Cursor subagent adapters
  copyMissingTree(join(srcRoot, '.agents', 'workflows'), join(p, '.agents', 'workflows'), scaffolded);
  copyMissingTree(join(srcRoot, '.agents', 'agents'), join(p, '.agents', 'agents'), scaffolded);
  copyMissingTree(join(srcRoot, '.cursor', 'agents'), join(p, '.cursor', 'agents'), scaffolded);

  // Core always-on rule + profile/stack conditional rules
  const enabledRules = new Set(['factory-quality']);
  if (['web', 'enterprise', 'iot'].includes(profileId)) enabledRules.add('frontend-standards');
  if (adapters.some(a => ['postgres', 'prisma', 'sqlserver'].includes(a))) enabledRules.add('database-migrations');
  if (profileId === 'ai' || adapters.includes('biometrics')) enabledRules.add('biometric-privacy');
  if (profileId === 'legacy' || adapters.includes('iis_asp')) enabledRules.add('iis-windows-deploy');
  if (profileId === 'game') enabledRules.add('game-engineering');

  mkdirSync(join(p, '.agents', 'rules'), { recursive: true });
  mkdirSync(join(p, '.cursor', 'rules'), { recursive: true });
  for (const r of enabledRules) {
    const agSrc = join(srcRoot, '.agents', 'rules', `${r}.md`);
    const agDst = join(p, '.agents', 'rules', `${r}.md`);
    if (existsSync(agSrc) && !existsSync(agDst)) { copyFileSync(agSrc, agDst); scaffolded.push(agDst); }
    const curSrc = join(srcRoot, '.cursor', 'rules', `${r}.mdc`);
    const curDst = join(p, '.cursor', 'rules', `${r}.mdc`);
    if (existsSync(curSrc) && !existsSync(curDst)) { copyFileSync(curSrc, curDst); scaffolded.push(curDst); }
  }

  // Core factory-* skills + profile-matched eng-* skills only (avoid unrelated skill bloat)
  const profileSkillSet = new Set(PROJECT_PROFILES[profileId]?.recommended_skills || []);
  const srcSkillsDir = join(srcRoot, '.agents', 'skills');
  if (existsSync(srcSkillsDir)) {
    for (const sk of readdirSync(srcSkillsDir, { withFileTypes: true })) {
      if (!sk.isDirectory()) continue;
      if (!sk.name.startsWith('factory-') && !profileSkillSet.has(sk.name)) continue;
      copyMissingTree(join(srcSkillsDir, sk.name), join(p, '.agents', 'skills', sk.name), scaffolded);
      copyMissingTree(join(srcSkillsDir, sk.name), join(p, '.cursor', 'skills', sk.name), scaffolded);
    }
  }
}

export function init(p, opts = {}) {
  p = asPath(p);
  must(existsSync(p), `Project path does not exist: ${p}`);
  const conf = join(store(p), 'config.json');
  const stack = inspectProjectStack(p);
  const requestedProfile = normalizeProfileId(opts.profile || 'auto');
  const detected = detectProjectProfile(p, stack);
  const profileId = requestedProfile === 'auto' ? detected.profileId : requestedProfile;
  const freshInit = !existsSync(conf);
  const isLegacy = existsSync(join(p, 'package.json')) || existsSync(join(p, 'pyproject.toml')) ||
    existsSync(join(p, 'web.config')) || existsSync(join(p, 'pubspec.yaml')) || existsSync(join(p, '.git'));

  const recSkills = recommendSkills(p, { offline: opts.offline !== false });
  const existingRules = [
    ...(existsSync(join(p, '.agents', 'rules')) ? readdirSync(join(p, '.agents', 'rules')) : []),
    ...(existsSync(join(p, '.cursor', 'rules')) ? readdirSync(join(p, '.cursor', 'rules')) : [])
  ];

  if (opts.dryRun) {
    return {
      dry_run: true,
      project: p,
      fresh_init: freshInit,
      is_legacy: isLegacy,
      profile: profileId,
      adapters: stack.adapters,
      required_checks: stack.required_checks,
      existing_rules: existingRules,
      recommended_skills: recSkills.recommended.map(r => r.name)
    };
  }

  if (freshInit) {
    putJson(conf, {
      schema: 2,
      factory_version: VERSION,
      name: opts.name || basename(p),
      profile: profileId,
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
  mkdirSync(join(store(p), 'memory'), { recursive: true });
  const ig = join(store(p), '.gitignore');
  if (!existsSync(ig)) writeFileSync(ig, '*\n', 'utf8');

  const scaffolded = [];
  if (opts.full && !opts.factoryOnly) {
    scaffoldWorkspaceFiles(ROOT, p, profileId, stack.adapters, scaffolded);
  }

  const config = readJson(conf);
  let retrievedMemories = [];
  withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    if (freshInit && readdirSync(join(store(p), 'tasks')).length === 0) {
      db.resetProjectTasks(proj.id);
    } else {
      syncTasksFromDisk(db, proj);
    }
    db.setProjectProfile(proj.id, {
      profileId,
      detectedStack: stack.adapters,
      overrideBy: requestedProfile === 'auto' ? null : 'init-flag'
    });
    const gDb = resolveGlobalMemoryDb(p);
    try {
      const memRes = retrieveRelevantMemories({
        projectDb: db,
        globalDb: gDb,
        projectId: proj.id,
        profileId,
        stack: stack.adapters,
        query: `${profileId} ${stack.adapters.join(' ')}`,
        limit: 8
      });
      retrievedMemories = memRes.items;
    } finally {
      gDb.close();
    }
    syncProjectMemoryViews(p, db, proj.id);
    db.log(proj.id, `Initialized project ${proj.name} (profile: ${profileId}, adapters: ${stack.adapters.join(', ') || 'generic'})`, { agentRole: 'director' });
  });

  if (opts.full && !opts.factoryOnly) {
    syncProject({ projectPath: p, factoryRoot: ROOT, dryRun: false });
  }

  return {
    project: p,
    profile: profileId,
    is_legacy: isLegacy,
    adapters: stack.adapters,
    runtimes: stack.runtimes,
    config,
    scaffolded_count: scaffolded.length,
    retrieved_global_memories: retrievedMemories.filter(m => m.origin === 'global').map(m => ({ id: m.id, category: m.category, statement: m.statement, source_type: m.source_type })),
    recommended_skills: recSkills.recommended.map(r => r.name)
  };
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
      try {
        learnFromProject({ projectPath: p, projectDb: db, globalDb: null, taskId: t.id });
      } catch {
        // Never allow learning hook errors to alter verification outcome.
      }
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
  const gDbPath = process.env.FACTORY_GLOBAL_MEMORY_DB
    ? resolve(process.env.FACTORY_GLOBAL_MEMORY_DB)
    : join(resolveGlobalHomeDir(p), 'memory', 'global-memory.db');
  withDb(p, db => {
    const proj = syncProjectRecord(db, p);
    syncTasksFromDisk(db, proj);
  });
  return startDashboardServer({ dbPath, globalDbPath: gDbPath, openDbFn: openFactoryDb, projectPath: p, port, version: VERSION });
}

export function doctor(p) {
  p = asPath(p);
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const globalSkills = join(home, '.gemini', 'config', 'skills');
  const globalWorkflows = join(home, '.gemini', 'workflows');
  const cursorSkillsDir = join(home, '.cursor', 'skills');
  const cursorRuleFile = join(home, '.cursor', 'rules', 'factory-quality.mdc');
  const cursorAgentsDir = join(home, '.cursor', 'agents');
  const antigravityAgentsDir = join(ROOT, '.agents', 'agents');
  const skills = existsSync(globalSkills) ? readdirSync(globalSkills).filter(d => existsSync(join(globalSkills, d, 'SKILL.md'))) : [];
  const cursorInstalled = existsSync(cursorSkillsDir) ? readdirSync(cursorSkillsDir).filter(d => existsSync(join(cursorSkillsDir, d, 'SKILL.md'))) : [];
  const workflows = existsSync(globalWorkflows) ? readdirSync(globalWorkflows).filter(f => f.endsWith('.md')) : [];
  const cursorAgentsCount = existsSync(cursorAgentsDir) ? readdirSync(cursorAgentsDir).filter(f => f.endsWith('.md')).length : 0;
  const antigravityAgentsCount = existsSync(antigravityAgentsDir) ? readdirSync(antigravityAgentsDir).length : 0;
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
  let schemaVersion = 0;
  let registeredSkillsCount = 0;
  try {
    const db = openFactoryDb(dbPath);
    try {
      sqliteOk = true;
      schemaVersion = db.schemaVersion();
      registeredSkillsCount = db.listSkillRecords().length;
    } finally {
      db.close();
    }
  } catch {}

  const globalHome = resolveGlobalHomeDir(p);
  let globalMemoryOk = false;
  let globalMemoryCount = 0;
  let globalMemoryDbPath = null;
  try {
    const gDb = resolveGlobalMemoryDb(p);
    try {
      globalMemoryOk = true;
      globalMemoryDbPath = gDb.path;
      globalMemoryCount = gDb.listMemories({ scope: 'global', status: 'active', limit: 1000 }).length;
    } finally {
      gDb.close();
    }
  } catch {}

  const agentVal = validateAgentDefinitions(ROOT);

  return {
    version: VERSION,
    schema_version: schemaVersion,
    expected_schema_version: CURRENT_SCHEMA_VERSION,
    node: process.version,
    sqlite_ok: sqliteOk,
    db_path: dbPath,
    global_home: globalHome,
    global_memory_db: globalMemoryDbPath,
    global_memory_ok: globalMemoryOk,
    global_memory_count: globalMemoryCount,
    git: gitVersion,
    project: p,
    initialized: existsSync(join(store(p), 'config.json')),
    adapters: existsSync(p) ? inspectProjectStack(p).adapters : [],
    runtimes: detectRuntimes(),
    providers: detectProviders(),
    specialist_agent_count: SPECIALIST_AGENTS.length,
    specialist_categories: AGENT_CATEGORIES,
    agent_definitions_valid: agentVal.ok,
    antigravity_agents_count: antigravityAgentsCount,
    cursor_agents_count: cursorAgentsCount,
    registered_skills_count: registeredSkillsCount,
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
  factory version
  factory doctor [project]
  factory init [project] [--profile auto|web|mobile|desktop|game|ai|iot|legacy|enterprise|generic] [--offline] [--dry-run] [--factory-only] [--skip-external]
  factory plan [project] --goal "Requirements..." [--roles backend,frontend,database]
  factory create [project] --name "Task" --criteria "Outcome" [--role backend]
  factory run [project] [--pipeline ID] [--concurrency 3]
  factory status [project]
  factory list [project]
  factory worktree [project] --id TASK_ID
  factory integrate [project] --id TASK_ID
  factory verify [project] [--id TASK_ID]
  factory review [project] [--id TASK_ID]
  factory fix [project] [--id TASK_ID] [--retry]
  factory release [project] --version "0.1.0-rc.1" [--id TASK_ID]
  factory approve [project] --id TASK_ID --by "Owner" [--release REL_ID]
  factory resume [project] [--pipeline ID]
  factory cancel [project] --id TASK_ID [--reason "..."]
  factory logs [project] [--limit 50]
  factory serve [project] [--port 4177]

  factory update [--check] [--dry-run] [--yes] [--skills] [--no-skills] [--force] [--rollback] [--source <path-or-url>]
  factory sync [project] [--dry-run] [--skills]
  factory agents [list [--category ...]|select [project] --request "..."|explain [project] --request "..."]
  factory skills <search|recommend|inspect|install|list|check|update|remove> ...
  factory learn [project] [--task ID] [--from-feedback] [--statement "..."] [--category ...] [--explicit]
  factory reflect [project]
  factory memory <list|search|review|approve|reject|export|import|disable|delete|consolidate> ...
  factory profile <show|set> [project] [name]
  factory deploy <advise|plan> [project] [--target ...]
  factory context <inspect|benchmark> [project] [--request "..."]

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

function firstPos(args, idx = 0) {
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (i + 1 < args.length && !args[i + 1].startsWith('--') && !['dry-run', 'factory-only', 'skip-external', 'offline', 'yes', 'check', 'rollback', 'force', 'skills', 'no-skills', 'approve', 'global', 'overwrite', 'explicit', 'from-feedback', 'retry', 'load-references', 'include-candidates', 'promote'].includes(args[i].slice(2))) {
        i += 1;
      }
      continue;
    }
    pos.push(args[i]);
  }
  return pos[idx] || null;
}

const executed = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (executed) {
  (async () => {
    try {
      const [command, ...args] = process.argv.slice(2);
      const p = arg(args, 'project') || (args[0] && !args[0].startsWith('--') ? args[0] : process.cwd());
      let output;
      switch (command) {
        case 'version': case '--version': case '-v': {
          output = { version: VERSION, node: process.version, schema_version: CURRENT_SCHEMA_VERSION, specialists: SPECIALIST_AGENTS.length };
          break;
        }
        case 'init': {
          const full = !hasFlag(args, 'factory-only');
          const dryRun = hasFlag(args, 'dry-run');
          const offline = hasFlag(args, 'offline') || hasFlag(args, 'skip-external');
          output = init(p, {
            name: arg(args, 'name'),
            full,
            factoryOnly: hasFlag(args, 'factory-only'),
            profile: arg(args, 'profile') || 'auto',
            offline,
            dryRun
          });
          if (full && !dryRun && !offline && !isTestEnv() && process.env.FACTORY_SKIP_EXTERNAL !== '1') {
            const home = process.env.USERPROFILE || process.env.HOME || '';
            output.external_skills = ensureExternalSkills({
              skillTargets: [join(home, '.gemini', 'config', 'skills'), join(home, '.cursor', 'skills')],
              agentTargets: [join(home, '.cursor', 'agents')],
              skip: hasFlag(args, 'skip-external')
            });
          }
          break;
        }
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

        case 'update': {
          const targetDir = arg(args, 'target') || ROOT;
          output = withDb(targetDir, db => {
            const res = updateFactory({
              targetDir,
              source: arg(args, 'source'),
              check: hasFlag(args, 'check'),
              dryRun: hasFlag(args, 'dry-run'),
              yes: hasFlag(args, 'yes'),
              force: hasFlag(args, 'force'),
              rollback: hasFlag(args, 'rollback'),
              rollbackId: arg(args, 'rollback-id'),
              db,
              globalHome: resolveGlobalHomeDir(targetDir)
            });
            return res;
          });
          if (hasFlag(args, 'skills') && !hasFlag(args, 'no-skills') && output?.ok && !hasFlag(args, 'dry-run') && !hasFlag(args, 'check')) {
            output.skill_updates = updateSkills({ projectPath: process.cwd(), offline: hasFlag(args, 'offline') });
          }
          break;
        }

        case 'sync': {
          output = syncProject({
            projectPath: p,
            factoryRoot: ROOT,
            dryRun: hasFlag(args, 'dry-run'),
            skills: hasFlag(args, 'skills')
          });
          break;
        }

        case 'agents': {
          const sub = firstPos(args, 0);
          if (!sub) {
            output = Object.values(AGENT_ROLES);
          } else if (sub === 'list') {
            const cat = arg(args, 'category');
            const filtered = cat ? SPECIALIST_AGENTS.filter(a => a.category === cat) : SPECIALIST_AGENTS;
            output = {
              total: filtered.length,
              categories: AGENT_CATEGORIES,
              specialists: filtered.map(a => ({ id: a.id, name: a.name, category: a.category, legacyRole: a.legacyRole, readonly: a.readonly }))
            };
          } else if (sub === 'select' || sub === 'explain') {
            const projPath = asPath(firstPos(args, 1) || process.cwd());
            const request = arg(args, 'request') || arg(args, 'goal') || '';
            const stack = existsSync(projPath) ? inspectProjectStack(projPath, { includeRuntimes: false }) : { adapters: [] };
            const detected = existsSync(projPath) ? detectProjectProfile(projPath, stack).profileId : 'generic';
            const files = arg(args, 'files') ? arg(args, 'files').split(',').map(s => s.trim()) : [];
            const sel = selectSpecialists({ request, profileId: detected, stack, files, risk: arg(args, 'risk') });
            output = sub === 'explain' ? { ...sel, explanation: explainSelection(sel) } : sel;
          } else {
            throw new Error(`Unknown agents subcommand: ${sub}`);
          }
          break;
        }

        case 'skills': {
          const sub = firstPos(args, 0) || 'list';
          const offline = hasFlag(args, 'offline');
          if (sub === 'search') {
            const query = firstPos(args, 1) || arg(args, 'query') || '';
            output = searchSkills(query, { projectPath: arg(args, 'project') || '.', offline });
          } else if (sub === 'recommend') {
            output = recommendSkills(firstPos(args, 1) || '.', { offline: true });
          } else if (sub === 'inspect') {
            const target = firstPos(args, 1);
            must(target, 'Usage: factory skills inspect <skill-dir-or-name>');
            const dir = existsSync(target) ? target : join(ROOT, '.agents', 'skills', target);
            output = inspectSkillSecurity(dir);
          } else if (sub === 'install') {
            const spec = firstPos(args, 1);
            const proj = asPath(arg(args, 'project') || process.cwd());
            output = withDb(proj, db => installSkill(spec, {
              projectPath: proj,
              global: hasFlag(args, 'global'),
              approve: hasFlag(args, 'approve'),
              offline,
              overwrite: hasFlag(args, 'overwrite'),
              db,
              globalHome: resolveGlobalHomeDir(proj)
            }));
          } else if (sub === 'list') {
            const proj = asPath(firstPos(args, 1) || process.cwd());
            output = existsSync(join(store(proj), 'config.json'))
              ? withDb(proj, db => listSkills({ projectPath: proj, db }))
              : listSkills({ projectPath: proj, db: null });
          } else if (sub === 'check') {
            output = checkSkills({ projectPath: firstPos(args, 1) || '.' });
          } else if (sub === 'update') {
            const proj = asPath(firstPos(args, 1) || process.cwd());
            output = withDb(proj, db => updateSkills({ projectPath: proj, offline, db }));
          } else if (sub === 'remove') {
            const name = firstPos(args, 1);
            must(name, 'Usage: factory skills remove <skill-name>');
            const proj = asPath(arg(args, 'project') || process.cwd());
            output = existsSync(join(store(proj), 'factory.db'))
              ? withDb(proj, db => removeSkill(name, { projectPath: proj, db }))
              : removeSkill(name, { projectPath: proj, db: null });
          } else {
            throw new Error(`Unknown skills subcommand: ${sub}`);
          }
          break;
        }

        case 'learn': {
          const projPath = asPath(p);
          requireInit(projPath);
          output = withDb(projPath, db => {
            const gDb = resolveGlobalMemoryDb(projPath);
            try {
              return learnFromProject({
                projectPath: projPath,
                projectDb: db,
                globalDb: gDb,
                taskId: arg(args, 'task'),
                fromFeedback: hasFlag(args, 'from-feedback'),
                statement: arg(args, 'statement'),
                category: arg(args, 'category') || 'engineering',
                explicit: hasFlag(args, 'explicit'),
                evidence: arg(args, 'evidence')
              });
            } finally {
              gDb.close();
            }
          });
          break;
        }

        case 'reflect': {
          const projPath = asPath(p);
          requireInit(projPath);
          output = withDb(projPath, db => {
            const proj = syncProjectRecord(db, projPath);
            return proposeImprovements({ projectDb: db, projectId: proj.id });
          });
          break;
        }

        case 'memory': {
          const sub = firstPos(args, 0) || 'list';
          const projPath = asPath(arg(args, 'project') || process.cwd());
          const hasProjDb = existsSync(join(store(projPath), 'config.json'));
          const gDb = resolveGlobalMemoryDb(projPath);
          try {
            if (sub === 'list') {
              const scope = arg(args, 'scope');
              const globalRows = scope === 'project' ? [] : gDb.listMemories({ scope: 'global', category: arg(args, 'category'), status: arg(args, 'status') || 'active', limit: Number(arg(args, 'limit') || 100) });
              const projRows = hasProjDb && scope !== 'global'
                ? withDb(projPath, db => db.listMemories({ scope: 'project', projectId: projectIdForPath(projPath), category: arg(args, 'category'), status: arg(args, 'status') || 'active', limit: Number(arg(args, 'limit') || 100) }))
                : [];
              output = { global: globalRows, project: projRows };
            } else if (sub === 'search') {
              const q = firstPos(args, 1) || arg(args, 'query') || '';
              const globalMatches = gDb.listMemories({ query: q, limit: 50 });
              const projMatches = hasProjDb ? withDb(projPath, db => db.listMemories({ projectId: projectIdForPath(projPath), query: q, limit: 50 })) : [];
              output = { query: q, global: globalMatches, project: projMatches };
            } else if (sub === 'review') {
              const globalCand = gDb.listMemories({ scope: 'global', verificationStatus: 'candidate', status: 'active', limit: 100 });
              const projCand = hasProjDb ? withDb(projPath, db => db.listMemories({ projectId: projectIdForPath(projPath), verificationStatus: 'candidate', status: 'active', limit: 100 })) : [];
              output = { pending_global: globalCand, pending_project: projCand };
            } else if (sub === 'approve') {
              const id = arg(args, 'id') || firstPos(args, 1);
              must(id, 'Usage: factory memory approve --id <mem-id>');
              if (gDb.getMemory(id)) {
                output = approveMemory(gDb, id, { by: arg(args, 'by') || 'owner' });
                syncGlobalMemoryViews(resolveGlobalHomeDir(projPath), gDb);
              } else if (hasProjDb) {
                output = withDb(projPath, db => approveMemory(db, id, { by: arg(args, 'by') || 'owner', promoteToGlobalDb: hasFlag(args, 'promote') ? gDb : null }));
                syncGlobalMemoryViews(resolveGlobalHomeDir(projPath), gDb);
              } else {
                throw new Error(`Memory not found: ${id}`);
              }
            } else if (sub === 'reject') {
              const id = arg(args, 'id') || firstPos(args, 1);
              must(id, 'Usage: factory memory reject --id <mem-id>');
              output = gDb.getMemory(id)
                ? rejectMemory(gDb, id, arg(args, 'reason') || 'Rejected')
                : withDb(projPath, db => rejectMemory(db, id, arg(args, 'reason') || 'Rejected'));
            } else if (sub === 'disable') {
              const id = arg(args, 'id') || firstPos(args, 1);
              must(id, 'Usage: factory memory disable --id <mem-id>');
              output = gDb.getMemory(id) ? disableMemory(gDb, id) : withDb(projPath, db => disableMemory(db, id));
            } else if (sub === 'delete') {
              const id = arg(args, 'id') || firstPos(args, 1);
              must(id, 'Usage: factory memory delete --id <mem-id>');
              output = gDb.getMemory(id) ? deleteMemory(gDb, id) : withDb(projPath, db => deleteMemory(db, id));
            } else if (sub === 'consolidate') {
              output = {
                global: consolidateMemories(gDb),
                project: hasProjDb ? withDb(projPath, db => consolidateMemories(db, { projectId: projectIdForPath(projPath) })) : null
              };
            } else if (sub === 'export') {
              const filePath = arg(args, 'file') || firstPos(args, 1) || join(projPath, 'factory-memory-export.json');
              output = exportMemories(gDb, {
                filePath,
                scope: arg(args, 'scope'),
                includeCandidates: hasFlag(args, 'include-candidates'),
                passphrase: arg(args, 'passphrase')
              });
            } else if (sub === 'import') {
              const filePath = firstPos(args, 1) || arg(args, 'file');
              must(filePath, 'Usage: factory memory import <file> [--passphrase "..."]');
              output = importMemories(gDb, filePath, { passphrase: arg(args, 'passphrase') });
              syncGlobalMemoryViews(resolveGlobalHomeDir(projPath), gDb);
            } else {
              throw new Error(`Unknown memory subcommand: ${sub}`);
            }
          } finally {
            gDb.close();
          }
          break;
        }

        case 'profile': {
          const sub = firstPos(args, 0) || 'show';
          if (sub === 'show') {
            const projPath = asPath(firstPos(args, 1) || '.');
            const stack = inspectProjectStack(projPath, { includeRuntimes: false });
            const det = detectProjectProfile(projPath, stack);
            const saved = existsSync(join(store(projPath), 'config.json'))
              ? withDb(projPath, db => db.getProjectProfile(projectIdForPath(projPath)))
              : null;
            const activeId = saved?.profile_id || det.profileId;
            output = { project: projPath, active_profile: activeId, saved_override: saved?.override_by || null, detected: det.profileId, profile: PROJECT_PROFILES[activeId] };
          } else if (sub === 'set') {
            const a1 = firstPos(args, 1);
            const a2 = firstPos(args, 2);
            const projPath = a2 ? asPath(a1) : process.cwd();
            const rawProf = a2 || a1;
            must(rawProf, 'Usage: factory profile set [project] <profile-name>');
            requireInit(projPath);
            const norm = normalizeProfileId(rawProf);
            const resolvedProf = norm === 'auto' ? detectProjectProfile(projPath, inspectProjectStack(projPath, { includeRuntimes: false })).profileId : norm;
            output = withDb(projPath, db => {
              const proj = syncProjectRecord(db, projPath);
              const res = db.setProjectProfile(proj.id, { profileId: resolvedProf, detectedStack: proj.adapter_ids, overrideBy: 'operator' });
              syncProjectMemoryViews(projPath, db, proj.id);
              return res;
            });
          } else {
            throw new Error(`Unknown profile subcommand: ${sub}`);
          }
          break;
        }

        case 'deploy': {
          const sub = firstPos(args, 0) || 'advise';
          const projPath = asPath(firstPos(args, 1) || '.');
          const hasProjDb = existsSync(join(store(projPath), 'config.json'));
          const gDb = resolveGlobalMemoryDb(projPath);
          try {
            if (sub === 'advise') {
              output = hasProjDb
                ? withDb(projPath, db => adviseDeployment({ projectPath: projPath, projectDb: db, globalDb: gDb }))
                : adviseDeployment({ projectPath: projPath, globalDb: gDb });
            } else if (sub === 'plan') {
              output = hasProjDb
                ? withDb(projPath, db => generateDeploymentPlan({ projectPath: projPath, projectDb: db, globalDb: gDb, target: arg(args, 'target') }))
                : generateDeploymentPlan({ projectPath: projPath, globalDb: gDb, target: arg(args, 'target') });
            } else {
              throw new Error(`Unknown deploy subcommand: ${sub}`);
            }
          } finally {
            gDb.close();
          }
          break;
        }

        case 'context': {
          const sub = firstPos(args, 0) || 'inspect';
          const projPath = asPath(firstPos(args, 1) || '.');
          const hasProjDb = existsSync(join(store(projPath), 'config.json'));
          const gDb = resolveGlobalMemoryDb(projPath);
          try {
            if (sub === 'inspect') {
              const request = arg(args, 'request') || 'Inspect project context';
              output = hasProjDb
                ? withDb(projPath, db => buildTaskContext({ projectPath: projPath, projectDb: db, globalDb: gDb, request, loadReferences: hasFlag(args, 'load-references') }))
                : buildTaskContext({ projectPath: projPath, globalDb: gDb, request, loadReferences: hasFlag(args, 'load-references') });
            } else if (sub === 'benchmark') {
              output = hasProjDb
                ? withDb(projPath, db => runContextBenchmark({ projectPath: projPath, projectDb: db, globalDb: gDb }))
                : runContextBenchmark({ projectPath: projPath, globalDb: gDb });
            } else {
              throw new Error(`Unknown context subcommand: ${sub}`);
            }
          } finally {
            gDb.close();
          }
          break;
        }

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
      if ((command === 'verify' || command === 'test' || command === 'release' || command === 'review' || (command === 'skills' && firstPos(args, 0) === 'check') || command === 'update') && output && output.ok === false) {
        process.exitCode = 1;
      }
    } catch (e) {
      console.error('ERROR:', redactSecrets(e.message));
      process.exitCode = 1;
    }
  })();
}
