import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFactoryDb } from '../src/db.mjs';
import {
  buildManagedManifest,
  writeManagedManifest,
  updateFactory,
  syncProject,
  recoverInterruptedUpdate
} from '../src/updater.mjs';

function makeTempDir(t, prefix = 'factory-upd-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function createFactoryFixture(dir, version, cliEchoText, customRuleText = null) {
  mkdirSync(join(dir, 'bin'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, '.agents', 'rules'), { recursive: true });
  mkdirSync(join(dir, '.agents', 'skills', 'factory-init'), { recursive: true });
  mkdirSync(join(dir, '.agents', 'workflows'), { recursive: true });
  mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true });

  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'factory-fixture', version, type: 'module' }, null, 2));
  writeFileSync(join(dir, 'bin', 'factory.mjs'), `if (process.argv[2] === 'version') console.log('${cliEchoText}');\n`, 'utf8');
  writeFileSync(join(dir, '.agents', 'rules', 'factory-quality.md'), `# Policy ${version}\n`, 'utf8');
  writeFileSync(join(dir, '.cursor', 'rules', 'factory-quality.mdc'), `# Cursor ${version}\n`, 'utf8');
  writeFileSync(join(dir, '.agents', 'skills', 'factory-init', 'SKILL.md'), `---\nname: factory-init\n---\nVersion ${version}\n`, 'utf8');
  writeFileSync(join(dir, '.agents', 'workflows', 'factory-init.md'), `# Workflow ${version}\n`, 'utf8');

  writeManagedManifest(dir, buildManagedManifest(dir));

  if (customRuleText) {
    writeFileSync(join(dir, '.agents', 'rules', 'factory-quality.md'), customRuleText, 'utf8');
    writeFileSync(join(dir, '.cursor', 'rules', 'user-custom.mdc'), 'KEEP_USER_RULE\n', 'utf8');
  }
}

test('mandatory update scenario: dry-run no-op, preserves user rule, updates managed files, migrates DB, and rolls back on simulated failure', t => {
  const root = makeTempDir(t);
  const globalHome = join(root, 'global-home');
  const installDir = join(root, 'install-v02');
  const newerDir = join(root, 'source-v10');

  createFactoryFixture(installDir, '0.2.0', '0.2.0', 'USER_CUSTOMIZED_QUALITY_RULE\n');
  createFactoryFixture(newerDir, '1.0.0', '1.0.0');
  mkdirSync(join(newerDir, '.agents', 'skills', 'factory-update'), { recursive: true });
  writeFileSync(join(newerDir, '.agents', 'skills', 'factory-update', 'SKILL.md'), '---\nname: factory-update\n---\nNew skill v1.0.0\n', 'utf8');

  const db = openFactoryDb(join(globalHome, 'factory.db'));
  try {
    // 1. Dry-run makes zero disk modifications
    const dry = updateFactory({ targetDir: installDir, source: newerDir, dryRun: true, globalHome, db });
    assert.equal(dry.ok, true);
    assert.equal(dry.from_version, '0.2.0');
    assert.equal(dry.to_version, '1.0.0');
    assert.ok(dry.preserved_custom.includes('.agents/rules/factory-quality.md'));
    assert.equal(JSON.parse(readFileSync(join(installDir, 'package.json'), 'utf8')).version, '0.2.0');

    // 2. Simulated failure rolls back completely
    const failSim = updateFactory({ targetDir: installDir, source: newerDir, globalHome, db, simulateFailureStep: 'after_copy' });
    assert.equal(failSim.ok, false);
    assert.equal(failSim.rolled_back, true);
    assert.equal(JSON.parse(readFileSync(join(installDir, 'package.json'), 'utf8')).version, '0.2.0');
    assert.equal(readFileSync(join(installDir, '.agents', 'rules', 'factory-quality.md'), 'utf8'), 'USER_CUSTOMIZED_QUALITY_RULE\n');
    assert.equal(existsSync(join(installDir, '.agents', 'skills', 'factory-update', 'SKILL.md')), false);

    // 3. Real update preserves user-owned rule & custom file even with --force, upgrades managed files
    const applied = updateFactory({ targetDir: installDir, source: newerDir, force: true, yes: true, globalHome, db });
    assert.equal(applied.ok, true);
    assert.equal(applied.status, 'updated');
    assert.equal(applied.schema_version, 2);
    assert.equal(JSON.parse(readFileSync(join(installDir, 'package.json'), 'utf8')).version, '1.0.0');
    assert.equal(readFileSync(join(installDir, '.agents', 'rules', 'factory-quality.md'), 'utf8'), 'USER_CUSTOMIZED_QUALITY_RULE\n');
    assert.equal(readFileSync(join(installDir, '.cursor', 'rules', 'user-custom.mdc'), 'utf8'), 'KEEP_USER_RULE\n');
    assert.equal(readFileSync(join(installDir, '.cursor', 'rules', 'factory-quality.mdc'), 'utf8'), '# Cursor 1.0.0\n');
    assert.ok(existsSync(join(installDir, '.agents', 'skills', 'factory-update', 'SKILL.md')));
    assert.ok(db.listUpdateHistory().some(u => u.status === 'completed'));

    // 4. Explicit rollback restores prior v0.2.0 files cleanly
    const rb = updateFactory({ targetDir: installDir, rollback: true, globalHome, db });
    assert.equal(rb.ok, true);
    assert.equal(JSON.parse(readFileSync(join(installDir, 'package.json'), 'utf8')).version, '0.2.0');
  } finally {
    db.close();
  }
});

test('updater protects dirty Git working trees, recovers interrupted updates, and syncProject handles project conflicts safely', t => {
  const root = makeTempDir(t);
  const globalHome = join(root, 'global-home');
  const gitTarget = join(root, 'git-factory');
  const newerSrc = join(root, 'newer-src');
  const project = join(root, 'user-project');

  createFactoryFixture(gitTarget, '0.2.0', '0.2.0');
  createFactoryFixture(newerSrc, '1.0.0', '1.0.0');

  execFileSync('git', ['init', '-q'], { cwd: gitTarget });
  execFileSync('git', ['config', 'user.email', 'test@example.test'], { cwd: gitTarget });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: gitTarget });
  execFileSync('git', ['add', '.'], { cwd: gitTarget });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: gitTarget });

  // Dirty modification refuses destructive apply
  writeFileSync(join(gitTarget, 'bin', 'factory.mjs'), '// local dirty edit\n', 'utf8');
  assert.throws(() => updateFactory({ targetDir: gitTarget, source: newerSrc, globalHome }), /Modified Git working tree/i);
  assert.equal(readFileSync(join(gitTarget, 'bin', 'factory.mjs'), 'utf8'), '// local dirty edit\n');

  // Interrupted update recovery journal test
  const intDir = join(root, 'interrupted');
  createFactoryFixture(intDir, '0.2.0', '0.2.0');
  const bakDir = join(root, 'manual-bak');
  mkdirSync(join(bakDir, 'files', 'bin'), { recursive: true });
  writeFileSync(join(bakDir, 'files', 'bin', 'factory.mjs'), 'RESTORED_FROM_JOURNAL\n', 'utf8');
  writeFileSync(join(intDir, 'bin', 'factory.mjs'), 'HALF_WRITTEN_CRASH\n', 'utf8');
  writeFileSync(join(intDir, '.factory-update-in-progress.json'), JSON.stringify({ from_version: '0.2.0', backup_path: bakDir }), 'utf8');
  const rec = recoverInterruptedUpdate(intDir);
  assert.equal(rec.recovered, true);
  assert.equal(readFileSync(join(intDir, 'bin', 'factory.mjs'), 'utf8'), 'RESTORED_FROM_JOURNAL\n');

  // Project sync updates unmodified managed files and preserves + diffs customized project files
  const v0Src = join(root, 'v0-factory');
  const v1Src = join(root, 'v1-factory');
  createFactoryFixture(v0Src, '0.2.0', '0.2.0');
  createFactoryFixture(v1Src, '1.0.0', '1.0.0');

  mkdirSync(join(project, '.factory'), { recursive: true });
  const initialSync = syncProject({ projectPath: project, factoryRoot: v0Src });
  assert.ok(initialSync.added_count >= 2);

  // User customizes workflow in project; keeps quality rule untouched
  writeFileSync(join(project, '.agents', 'workflows', 'factory-init.md'), 'CUSTOM_PROJECT_WORKFLOW\n', 'utf8');

  const drySync = syncProject({ projectPath: project, factoryRoot: v1Src, dryRun: true });
  assert.ok(drySync.updated.includes('.agents/rules/factory-quality.md'));
  assert.equal(drySync.conflicts.length, 1);
  assert.equal(drySync.conflicts[0].file, '.agents/workflows/factory-init.md');

  const appliedSync = syncProject({ projectPath: project, factoryRoot: v1Src });
  assert.equal(readFileSync(join(project, '.agents', 'rules', 'factory-quality.md'), 'utf8'), '# Policy 1.0.0\n');
  assert.equal(readFileSync(join(project, '.agents', 'workflows', 'factory-init.md'), 'utf8'), 'CUSTOM_PROJECT_WORKFLOW\n');
  assert.equal(appliedSync.conflict_count, 1);
});
