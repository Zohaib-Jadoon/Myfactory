import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFactoryDb } from '../src/db.mjs';
import { assertInsideRoot, enforceSafetyPolicy, redactSecrets, scanSecrets } from '../src/security.mjs';
import { inspectProjectStack } from '../src/adapters.mjs';
import { createPipelinePlan, cancelTask, integrateWorktree, prepareReleaseCandidate, resumeTasks, runOrchestrator } from '../src/orchestrator.mjs';
import { runQualityGates } from '../src/gates.mjs';
import { init, create, makeWorktree, verify, approve, serve } from '../bin/factory.mjs';

const gitRun = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

function setupRepo(t, { withGit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-orch-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (withGit) {
    gitRun(dir, ['init', '-q']);
    gitRun(dir, ['config', 'user.email', 'factory@example.test']);
    gitRun(dir, ['config', 'user.name', 'Factory Test']);
    writeFileSync(join(dir, 'README.md'), '# Demo\n', 'utf8');
    gitRun(dir, ['add', 'README.md']);
    gitRun(dir, ['commit', '-qm', 'init']);
  }
  return dir;
}

test('secret redaction and content scanner detect leaks without exposing raw values', t => {
  const dir = setupRepo(t, { withGit: true });
  const fakeGh = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const fakeAws = 'AKIA' + 'IOSFODNN7EXAMPLE';
  writeFileSync(join(dir, 'leak.txt'), `token=${fakeGh}\naws=${fakeAws}\n`, 'utf8');
  gitRun(dir, ['add', 'leak.txt']);
  gitRun(dir, ['commit', '-qm', 'add leak']);

  const scan = scanSecrets(dir);
  assert.equal(scan.ok, false);
  assert.ok(scan.findings.some(f => f.category === 'github-token'));
  assert.ok(scan.findings.some(f => f.category === 'aws-access-key'));

  const scrubbed = redactSecrets(`error using ${fakeGh} and ${fakeAws}`);
  assert.ok(!scrubbed.includes(fakeGh));
  assert.ok(!scrubbed.includes(fakeAws));
  assert.ok(scrubbed.includes('[REDACTED_GITHUB_TOKEN]'));
  assert.ok(scrubbed.includes('[REDACTED_AWS_KEY]'));
});

test('path boundary jail and safety policy enforce non-overridable controls', t => {
  const dir = setupRepo(t, { withGit: false });
  assert.throws(() => assertInsideRoot(dir, '../outside'), /escapes project boundary/i);
  assert.equal(assertInsideRoot(dir, '.'), dir);

  const policy = enforceSafetyPolicy({ automatic_deployment: true, human_approval_required: false, allow_outside_root: true });
  assert.equal(policy.automatic_deployment, false);
  assert.equal(policy.human_approval_required, true);
  assert.equal(policy.allow_outside_root, false);
});

test('universal project adapters detect multi-stack monorepo without fabricating checks', t => {
  const dir = setupRepo(t, { withGit: false });
  mkdirSync(join(dir, 'frontend'), { recursive: true });
  mkdirSync(join(dir, 'backend'), { recursive: true });
  mkdirSync(join(dir, 'mobile'), { recursive: true });

  writeFileSync(join(dir, 'frontend', 'package.json'), JSON.stringify({
    dependencies: { next: '15.0.0', react: '19.0.0' },
    scripts: { lint: 'echo lint', typecheck: 'echo tc', test: 'echo test', build: 'echo build' }
  }));
  writeFileSync(join(dir, 'backend', 'package.json'), JSON.stringify({
    dependencies: { '@nestjs/core': '11.0.0' },
    scripts: { test: 'echo nest-test', build: 'echo nest-build' }
  }));
  writeFileSync(join(dir, 'mobile', 'pubspec.yaml'), 'name: app\n');
  writeFileSync(join(dir, 'Dockerfile'), 'FROM node:24-alpine\n');

  const stack = inspectProjectStack(dir, { includeRuntimes: false });
  assert.ok(stack.adapters.includes('nextjs'));
  assert.ok(stack.adapters.includes('nestjs'));
  assert.ok(stack.adapters.includes('flutter'));
  assert.ok(stack.adapters.includes('docker'));
  assert.ok(stack.adapters.includes('monorepo'));
  assert.ok(stack.required_checks.some(c => c.name === 'frontend-build' && c.cwd === 'frontend'));
  assert.ok(stack.required_checks.some(c => c.name === 'backend-test' && c.cwd === 'backend'));
  assert.ok(stack.required_checks.some(c => c.name === 'mobile-flutter-test' && c.cwd === 'mobile'));
});

test('missing binary check produces NOT VERIFIED and blocks gate', t => {
  const dir = setupRepo(t, { withGit: true });
  init(dir);
  const cfgPath = join(dir, '.factory', 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.required_checks = [{ name: 'missing-tool', command: 'nonexistent_binary_xyz_999', args: ['--version'] }];
  writeFileSync(cfgPath, JSON.stringify(cfg));

  const report = runQualityGates({ projectPath: dir });
  assert.equal(report.ok, false);
  const chk = report.results.find(r => r.name === 'missing-tool');
  assert.equal(chk.status, 'NOT VERIFIED');
  assert.equal(chk.ok, false);
});

test('orchestrator DAG scheduling, retries, cancellation, resume, and release gate', async t => {
  const dir = setupRepo(t, { withGit: true });
  writeFileSync(join(dir, 'app.mjs'), 'export const add = (a, b) => a + b;\n', 'utf8');
  writeFileSync(join(dir, 'app.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { add } from './app.mjs'; test('adds', () => assert.equal(add(1,2),3));\n", 'utf8');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test app.test.mjs' } }));
  gitRun(dir, ['add', '.']);
  gitRun(dir, ['commit', '-qm', 'base app']);

  const dbPath = join(dir, '.factory', 'test-orch.db');
  const db = openFactoryDb(dbPath);
  try {

  init(dir);
  const proj = db.upsertProject({
    name: 'demo',
    path: dir,
    adapterIds: ['node'],
    config: JSON.parse(readFileSync(join(dir, '.factory', 'config.json'), 'utf8')),
    configHash: 'h1'
  });

  const { pipeline, tasks } = createPipelinePlan({
    db,
    project: proj,
    goal: 'Build REST API service with tests',
    roles: ['backend']
  });
  assert.ok(tasks.length >= 6);

  // Provide an explicit local deterministic worker for backend role
  mkdirSync(join(dir, '.factory', 'workers'), { recursive: true });
  writeFileSync(join(dir, '.factory', 'workers', 'backend.mjs'), "console.log('Backend worker completed');\n", 'utf8');

  const firstRun = await runOrchestrator({
    db,
    project: proj,
    pipelineId: pipeline.id,
    concurrency: 2,
    onVerify: (p, taskId) => runQualityGates({ projectPath: p, task: db.getTask(taskId), db, projectId: proj.id })
  });
  assert.ok(firstRun.executed.length >= 6, `Executed=${JSON.stringify(firstRun.executed)}`);
  assert.ok(existsSync(join(dir, 'docs', 'factory', 'PRD.md')));
  assert.ok(existsSync(join(dir, 'docs', 'factory', 'ARCHITECTURE.md')));
  assert.ok(existsSync(join(dir, 'docs', 'factory', 'RUNBOOK.md')));

  // Simulate an interrupted task and verify resume preserves completed tasks
  const pmTask = db.listTasks(proj.id).find(x => x.agent_role === 'product_manager');
  const qaTask = db.listTasks(proj.id).find(x => x.agent_role === 'qa');
  qaTask.status = 'running';
  db.saveTask(proj.id, qaTask);
  const recovered = resumeTasks({ db, project: proj, pipelineId: pipeline.id });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].id, qaTask.id);
  assert.equal(db.getTask(pmTask.id).status, 'completed');

  // Cancel a newly queued task
  const cancelTarget = db.saveTask(proj.id, {
    id: 'extra-task-1',
    pipeline_id: pipeline.id,
    title: 'Optional task',
    criteria: 'n/a',
    agent_role: 'backend',
    status: 'queued'
  });
  const cancelled = cancelTask({ db, project: proj, taskId: cancelTarget.id, reason: 'No longer needed' });
  assert.equal(cancelled.status, 'cancelled');

  // Commit generated docs so repo is clean for release candidate
  gitRun(dir, ['add', 'docs']);
  gitRun(dir, ['commit', '-qm', 'add factory docs']);

  const rcPass = prepareReleaseCandidate({ db, project: proj, version: '0.1.0-rc.1' });
  assert.equal(rcPass.ok, true, JSON.stringify(rcPass.reasons));
  assert.equal(rcPass.status, 'pending_approval');
  assert.ok(rcPass.approvalId);

  // Deliberately fail test script -> release candidate must be BLOCKED
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node -e "process.exit(1)"' } }));
  gitRun(dir, ['add', 'package.json']);
  gitRun(dir, ['commit', '-qm', 'break tests']);

  const rcFail = prepareReleaseCandidate({ db, project: proj, version: '0.1.0-rc.2' });
  assert.equal(rcFail.ok, false);
  assert.equal(rcFail.status, 'blocked');
  } finally {
    db.close();
  }
});

test('worktree integration merges verified branch into main without pushing', t => {
  const dir = setupRepo(t, { withGit: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
  gitRun(dir, ['add', '.']);
  gitRun(dir, ['commit', '-qm', 'base']);

  init(dir);
  const task = create(dir, 'Feature module', 'Exports hello()', { role: 'backend' });
  const wt = makeWorktree(dir, task.id);

  writeFileSync(join(wt.worktree, 'feature.mjs'), 'export const hello = () => "hi";\n', 'utf8');
  gitRun(wt.worktree, ['add', 'feature.mjs']);
  gitRun(wt.worktree, ['commit', '-qm', 'implement feature']);

  const v = verify(dir, task.id);
  assert.equal(v.ok, true);

  const db = openFactoryDb(join(dir, '.factory', 'factory.db'));
  try {
    const proj = db.getProject(dir);
    const merged = integrateWorktree({ db, project: proj, taskId: task.id });
    assert.ok(merged.head);
    assert.ok(existsSync(join(dir, 'feature.mjs')));
  } finally {
    db.close();
  }

  const vRoot = verify(dir, null);
  assert.equal(vRoot.ok, true);
});

test('dashboard JSON API returns persisted SQLite state cleanly', async t => {
  const dir = setupRepo(t, { withGit: true });
  init(dir);
  create(dir, 'Persisted API task', 'API returns 200');
  const server = serve(dir, 41909);
  try {
    const res = await fetch('http://127.0.0.1:41909/api/overview');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.projects.length >= 1, true);
    assert.equal(data.tasks[0].title, 'Persisted API task');

    const health = await fetch('http://127.0.0.1:41909/api/health');
    assert.equal(health.status, 200);
    const healthJson = await health.json();
    assert.equal(healthJson.sqlite, true);
  } finally {
    server.close();
  }
});
