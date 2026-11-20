import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFactoryDb } from '../src/db.mjs';
import { buildTaskContext, getCachedProjectSummary, runContextBenchmark } from '../src/context-engine.mjs';

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
