import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openFactoryDb } from '../src/db.mjs';
import { buildTaskContext, getCachedProjectSummary, runContextBenchmark } from '../src/context-engine.mjs';
import { adviseDeployment, generateDeploymentPlan } from '../src/deployment-advisor.mjs';
import { openGlobalMemoryDb, recordMemory } from '../src/memory.mjs';
import { init, create, serve } from '../bin/factory.mjs';

const CLI_BIN = resolve('bin/factory.mjs');

function makeGitProject(t) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-ctx-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' }, scripts: { test: 'node -e "process.exit(0)"' } }));
  mkdirSync(join(dir, '.factory'), { recursive: true });
  writeFileSync(join(dir, '.factory', 'config.json'), JSON.stringify({ schema: 2, adapters: ['nextjs'], required_checks: [] }));
  execFileSync('git', ['add', 'package.json'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

test('progressive context loader stays below naive baseline, avoids fan-out on FAST, and invalidates cache on git/config change', t => {
  const dir = makeGitProject(t);
  const db = openFactoryDb(join(dir, '.factory', 'factory.db'));
  try {
    db.upsertProject({ name: 'ctx-demo', path: dir, adapterIds: ['nextjs'], config: {}, configHash: 'h1' });

    const c1 = getCachedProjectSummary(dir);
    assert.equal(c1.cached, false);
    const c2 = getCachedProjectSummary(dir);
    assert.equal(c2.cached, true);

    // Config edit invalidates cache
    writeFileSync(join(dir, '.factory', 'config.json'), JSON.stringify({ schema: 2, adapters: ['nextjs', 'postgres'], required_checks: [] }));
    const c3 = getCachedProjectSummary(dir);
    assert.equal(c3.cached, false);

    // New git commit invalidates cache
    writeFileSync(join(dir, 'index.js'), 'export const x = 1;\n');
    execFileSync('git', ['add', 'index.js'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'second'], { cwd: dir });
    const c4 = getCachedProjectSummary(dir);
    assert.equal(c4.cached, false);

    const fast = buildTaskContext({ projectPath: dir, projectDb: db, request: 'Fix typo in button label' });
    assert.equal(fast.mode, 'FAST');
    assert.equal(fast.loaded_agent_count, 1);
    assert.equal(fast.loaded_reference_count, 0);
    assert.ok(fast.estimated_context_bytes < fast.baseline_context_bytes);
    assert.equal(fast.token_telemetry.available, false);

    const bench = runContextBenchmark({ projectPath: dir, projectDb: db });
    assert.equal(bench.cases.length, 4);
    assert.ok(bench.token_telemetry_status.includes('unavailable'));
    assert.equal(db.listContextMetrics().length, 5);
  } finally {
    db.close();
  }
});

test('deployment advisor respects existing hosting configs, avoids Kubernetes bloat, and applies learned deployment lessons', t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-dep-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const projWeb = join(root, 'existing-render-web');
  const projIis = join(root, 'iis-legacy');
  mkdirSync(projWeb, { recursive: true });
  mkdirSync(projIis, { recursive: true });

  writeFileSync(join(projWeb, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }));
  writeFileSync(join(projWeb, 'render.yaml'), 'services:\n  - type: web\n    name: app\n');
  writeFileSync(join(projIis, 'web.config'), '<configuration><system.webServer /></configuration>\n');

  const dbWeb = openFactoryDb(join(projWeb, '.factory', 'factory.db'));
  const dbIis = openFactoryDb(join(projIis, '.factory', 'factory.db'));
  const globalDb = openGlobalMemoryDb(join(root, 'global-home'));

  try {
    dbWeb.upsertProject({ name: 'web-render', path: projWeb, adapterIds: ['nextjs'], config: {}, configHash: 'w1' });
    const webAdvice = adviseDeployment({ projectPath: projWeb, projectDb: dbWeb, globalDb });
    assert.equal(webAdvice.recommended_platform, 'render');
    assert.equal(webAdvice.options.some(o => o.platform === 'kubernetes'), false);

    recordMemory(globalDb, {
      scope: 'global',
      type: 'explicit_preference',
      source_type: 'explicit_user',
      category: 'deployment',
      profile_scope: 'legacy',
      statement: 'Always back up web.config and set IIS application pool to No Managed Code before ARR proxy staging'
    });

    const pIis = dbIis.upsertProject({ name: 'iis-app', path: projIis, adapterIds: ['iis_asp'], config: {}, configHash: 'i1' });
    dbIis.setProjectProfile(pIis.id, { profileId: 'legacy', detectedStack: ['iis_asp'] });
    const plan = generateDeploymentPlan({ projectPath: projIis, projectDb: dbIis, globalDb });
    assert.equal(plan.recommended_platform, 'windows-iis');
    assert.ok(plan.relevant_lessons.some(l => l.statement.includes('No Managed Code')));
    assert.ok(plan.plan_markdown.includes('No Managed Code'));
    assert.ok(plan.plan_markdown.includes('never stop/recycle unrelated IIS pools'));
  } finally {
    dbWeb.close();
    dbIis.close();
    globalDb.close();
  }
});

test('extended dashboard endpoints return V1.0 SQLite views safely while staying read-only and XSS-escaped', async t => {
  const dir = makeGitProject(t);
  const db = openFactoryDb(join(dir, '.factory', 'factory.db'));
  try {
    const proj = db.upsertProject({ name: 'dash-v1', path: dir, adapterIds: ['nextjs'], config: {}, configHash: 'd1' });
    db.setProjectProfile(proj.id, { profileId: 'web', detectedStack: ['nextjs'] });
    recordMemory(db, {
      scope: 'project',
      project_id: proj.id,
      category: 'ui-ux',
      statement: '<script>alert("xss")</script> clean UI rule'
    });
    db.recordRoutingDecision({
      project_id: proj.id,
      request_summary: 'Fix auth bug',
      profile_id: 'web',
      complexity: 'STANDARD',
      primary_agent: 'backend-architect',
      supporting_agents: ['regression-debugger'],
      selected_skills: ['eng-backend']
    });
  } finally {
    db.close();
  }

  const server = serve(dir, 41927);
  t.after(() => server.close());

  const [htmlRes, agentsRes, skillsRes, memRes, updRes, metRes, postRes] = await Promise.all([
    fetch('http://127.0.0.1:41927/'),
    fetch('http://127.0.0.1:41927/api/agents'),
    fetch('http://127.0.0.1:41927/api/skills'),
    fetch('http://127.0.0.1:41927/api/memory'),
    fetch('http://127.0.0.1:41927/api/updates'),
    fetch('http://127.0.0.1:41927/api/metrics'),
    fetch('http://127.0.0.1:41927/api/memory', { method: 'POST' })
  ]);

  assert.equal(htmlRes.status, 200);
  const html = await htmlRes.text();
  assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert("xss")'));
  assert.equal(postRes.status, 405);

  const agents = await agentsRes.json();
  assert.equal(agents.total, 60);
  assert.equal(agents.routingDecisions.length, 1);

  const skills = await skillsRes.json();
  assert.ok(Array.isArray(skills.suggested));

  const mem = await memRes.json();
  assert.equal(mem.project.length, 1);
  assert.equal(mem.candidates.length, 1);

  const upd = await updRes.json();
  assert.equal(upd.version, '1.0.0');
  assert.equal(upd.schema_version, 2);

  const met = await metRes.json();
  assert.ok(Array.isArray(met.contextMetrics));
});

test('CLI end-to-end smoke checks work cleanly across all V1.0 commands in isolated sandbox', t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-cli-e2e-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const proj = join(root, 'nextjs-app');
  const globalHome = join(root, 'global-home');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' }, scripts: { test: 'node -e "process.exit(0)"' } }));

  const env = {
    ...process.env,
    FACTORY_GLOBAL_HOME: globalHome,
    FACTORY_DB_PATH: join(proj, '.factory', 'factory.db'),
    FACTORY_SKIP_EXTERNAL: '1'
  };
  const runCli = args => JSON.parse(execFileSync(process.execPath, [CLI_BIN, ...args], { cwd: proj, env, encoding: 'utf8' }));

  const ver = runCli(['version']);
  assert.equal(ver.version, '1.0.0');
  assert.equal(ver.specialists, 60);

  const dryInit = runCli(['init', '.', '--dry-run', '--offline']);
  assert.equal(dryInit.dry_run, true);
  assert.equal(dryInit.profile, 'web');
  assert.equal(existsSync(join(proj, '.factory', 'config.json')), false);

  const inited = runCli(['init', '.', '--profile', 'auto', '--offline']);
  assert.equal(inited.profile, 'web');
  assert.ok(existsSync(join(proj, '.factory', 'memory', 'project-memory.md')));
  assert.ok(existsSync(join(proj, '.agents', 'skills', 'eng-frontend', 'SKILL.md')));
  assert.equal(existsSync(join(proj, '.agents', 'skills', 'eng-games', 'SKILL.md')), false);

  const agentsList = runCli(['agents', 'list', '--category', 'game-development']);
  assert.equal(agentsList.total, 9);

  const agentSel = runCli(['agents', 'select', '.', '--request', 'Build NestJS REST API and PostgreSQL schema']);
  assert.ok(['backend-architect', 'postgres-neon-specialist', 'database-engineer'].includes(agentSel.primary_agent));

  const doc = runCli(['doctor', '.']);
  assert.equal(doc.schema_version, 2);
  assert.equal(doc.specialist_agent_count, 60);

  const srch = runCli(['skills', 'search', 'nextjs', '--offline']);
  assert.ok(srch.results.length >= 1);

  const rec = runCli(['skills', 'recommend', '.']);
  assert.equal(rec.profile, 'web');

  const learned = runCli(['learn', '.', '--from-feedback', '--statement', 'Use uncluttered Next.js dashboard cards', '--category', 'ui-ux']);
  assert.equal(learned.length, 1);

  const rev = runCli(['memory', 'review']);
  assert.equal(rev.pending_global.length, 1);
  const apr = runCli(['memory', 'approve', '--id', rev.pending_global[0].id, '--by', 'Owner']);
  assert.equal(apr.local.verification_status, 'approved');

  const refl = runCli(['reflect', '.']);
  assert.ok(typeof refl.stats.total_tasks === 'number');

  const prof = runCli(['profile', 'show', '.']);
  assert.equal(prof.active_profile, 'web');

  const dep = runCli(['deploy', 'advise', '.']);
  assert.ok(dep.options.length >= 1);

  const bench = runCli(['context', 'benchmark', '.']);
  assert.equal(bench.cases.length, 4);

  const synced = runCli(['sync', '.', '--dry-run']);
  assert.equal(synced.ok, true);
});
