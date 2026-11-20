import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFactoryDb, projectIdForPath } from '../src/db.mjs';
import {
  openGlobalMemoryDb,
  saveTaskMemory,
  readTaskMemory,
  recordMemory,
  approveMemory,
  disableMemory,
  deleteMemory,
  consolidateMemories,
  syncProjectMemoryViews,
  syncGlobalMemoryViews,
  retrieveRelevantMemories,
  learnFromProject,
  exportMemories,
  importMemories
} from '../src/memory.mjs';
import { proposeImprovements } from '../src/improvement.mjs';
import { selectSpecialists } from '../src/router.mjs';

function makeTempDir(t, prefix = 'factory-mem-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('mandatory cross-project learning scenario: Project A approved lesson transfers to Project B but stays isolated from Project C', t => {
  const root = makeTempDir(t);
  const globalHome = join(root, 'global-home');
  const projA = join(root, 'project-a-nextjs');
  const projB = join(root, 'project-b-nextjs');
  const projC = join(root, 'project-c-unity-game');
  mkdirSync(projA, { recursive: true });
  mkdirSync(projB, { recursive: true });
  mkdirSync(projC, { recursive: true });
  writeFileSync(join(projA, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }));
  writeFileSync(join(projB, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }));
  writeFileSync(join(projC, 'project.godot'), 'config_version=5\n');

  const projDbA = openFactoryDb(join(projA, '.factory', 'factory.db'));
  const projDbB = openFactoryDb(join(projB, '.factory', 'factory.db'));
  const projDbC = openFactoryDb(join(projC, '.factory', 'factory.db'));
  let globalDb = openGlobalMemoryDb(globalHome);

  try {
    const recA = projDbA.upsertProject({ name: 'projA', path: projA, adapterIds: ['nextjs', 'react'], config: {}, configHash: 'a1' });
    projDbA.setProjectProfile(recA.id, { profileId: 'web', detectedStack: ['nextjs', 'react'] });
    const recB = projDbB.upsertProject({ name: 'projB', path: projB, adapterIds: ['nextjs', 'react'], config: {}, configHash: 'b1' });
    projDbB.setProjectProfile(recB.id, { profileId: 'web', detectedStack: ['nextjs', 'react'] });
    const recC = projDbC.upsertProject({ name: 'projC', path: projC, adapterIds: ['godot'], config: {}, configHash: 'c1' });
    projDbC.setProjectProfile(recC.id, { profileId: 'game', detectedStack: ['godot'] });

    // Task completion in Project A -> verified lesson + UI feedback preference candidate
    const taskA = projDbA.saveTask(recA.id, {
      id: 'task-ui-a',
      title: 'Clean Next.js dashboard layout',
      criteria: 'Responsive dashboard with minimal clutter',
      agent_role: 'frontend',
      status: 'verified',
      verification: { ok: true, revision: 'abc1234', metrics: { passed_gates: 3 } }
    });

    const learned = learnFromProject({
      projectPath: projA,
      projectDb: projDbA,
      globalDb,
      taskId: taskA.id,
      fromFeedback: true,
      statement: 'Prefer clean uncluttered Next.js dashboards with responsive mobile breakpoints and modern card spacing',
      category: 'ui-ux',
      evidence: 'Repeated UI review feedback in Project A',
      profileScope: 'web'
    });
    assert.ok(learned.length >= 2);
    assert.ok(existsSync(join(projA, '.factory', 'memory', 'project-memory.md')));

    // Project-private note in Project A (not promoted globally)
    recordMemory(projDbA, {
      type: 'observation',
      scope: 'project',
      project_id: recA.id,
      category: 'decision',
      statement: 'Project A internal billing fiscal period runs Apr-Mar',
      verification_status: 'verified',
      verified: true,
      evidence_ref: 'task:task-ui-a'
    });

    // Candidate inferred preference must NOT leak to Project B until approved!
    const beforeApproval = retrieveRelevantMemories({
      projectDb: projDbB,
      globalDb,
      projectId: recB.id,
      profileId: 'web',
      stack: ['nextjs', 'react'],
      query: 'clean dashboard responsive layout'
    });
    assert.equal(beforeApproval.items.some(m => m.statement.includes('uncluttered Next.js dashboards')), false);

    // Approve global candidate and close/reopen global DB to prove persistence across restart
    const candidate = globalDb.listMemories({ scope: 'global', verificationStatus: 'candidate' })
      .find(m => m.statement.includes('uncluttered Next.js dashboards'));
    assert.ok(candidate);
    approveMemory(globalDb, candidate.id, { by: 'Owner' });
    syncGlobalMemoryViews(globalHome, globalDb);
    assert.ok(existsSync(join(globalHome, 'memory', 'user-preferences.md')));

    globalDb.close();
    globalDb = openGlobalMemoryDb(globalHome);

    // Project B retrieves the approved lesson and receives ZERO private context from Project A
    const retrievedB = retrieveRelevantMemories({
      projectDb: projDbB,
      globalDb,
      projectId: recB.id,
      profileId: 'web',
      stack: ['nextjs', 'react'],
      query: 'dashboard UI layout'
    });
    assert.ok(retrievedB.items.some(m => m.statement.includes('uncluttered Next.js dashboards')));
    assert.equal(retrievedB.items.some(m => m.statement.includes('internal billing fiscal period')), false);

    // Project C (Godot game) must NOT receive irrelevant Next.js web UI lesson
    const retrievedC = retrieveRelevantMemories({
      projectDb: projDbC,
      globalDb,
      projectId: recC.id,
      profileId: 'game',
      stack: ['godot'],
      query: 'physics player controller'
    });
    assert.equal(retrievedC.items.some(m => m.statement.includes('uncluttered Next.js dashboards')), false);

    const routingC = selectSpecialists({ request: 'Add Godot GDScript player movement', profileId: 'game', stack: { adapters: ['godot'] } });
    assert.equal(routingC.primary_agent, 'godot-developer');
  } finally {
    projDbA.close();
    projDbB.close();
    projDbC.close();
    globalDb.close();
  }
});

test('memory safeguards enforce sensitive rejection, conflict override, consolidation, failed-task blocking, disable/delete, and encrypted export/import', t => {
  const root = makeTempDir(t);
  const globalHome = join(root, 'global');
  const projPath = join(root, 'proj');
  mkdirSync(projPath, { recursive: true });

  const projDb = openFactoryDb(join(projPath, '.factory', 'factory.db'));
  const globalDb = openGlobalMemoryDb(globalHome);
  const targetDb = openGlobalMemoryDb(join(root, 'global-restored'));

  try {
    const proj = projDb.upsertProject({ name: 'sec-proj', path: projPath, adapterIds: ['nestjs'], config: {}, configHash: 'h1' });
    const projId = projectIdForPath(projPath);
    assert.equal(proj.id, projId);

    // Level 1 task memory round-trip
    saveTaskMemory(projPath, 't-1', { objective: 'Add DTO check', files: ['src/dto.ts'], decisions: ['Use Zod'] });
    assert.equal(readTaskMemory(projPath, 't-1').objective, 'Add DTO check');

    // Reject secrets, PII, connection strings, and biometric templates
    const fakeSecret = 'ghp_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';
    assert.throws(() => recordMemory(globalDb, { scope: 'global', statement: `Use token ${fakeSecret}`, type: 'explicit_preference' }), /sensitive memory content/i);
    assert.throws(() => recordMemory(globalDb, { scope: 'global', statement: 'User email alice.smith@example.com for testing', type: 'observation' }), /email-pii/i);
    assert.throws(() => recordMemory(globalDb, { scope: 'global', statement: 'face_embedding: [0.1234, -0.5678, 0.9123, 0.4421, -0.1122, 0.3344]', type: 'observation' }), /biometric/i);

    // Failed task cannot produce positive verified_lesson
    assert.throws(() => recordMemory(projDb, {
      scope: 'project',
      project_id: proj.id,
      type: 'verified_lesson',
      category: 'architecture',
      taskStatus: 'failed',
      statement: 'Shipping broken build pattern',
      evidence_ref: 'task:failed-1',
      verified: true
    }), /Failed or blocked tasks/i);

    // Unverified AI assertion downgrades to candidate
    const unverified = recordMemory(projDb, {
      scope: 'project',
      project_id: proj.id,
      type: 'verified_lesson',
      source_type: 'ai_assertion',
      statement: 'Unverified assertion claim'
    });
    assert.equal(unverified.verification_status, 'candidate');
    assert.equal(unverified.type, 'candidate_lesson');

    // Explicit preference vs inferred preference distinction + project override
    const globalPref = recordMemory(globalDb, {
      scope: 'global',
      type: 'explicit_preference',
      source_type: 'explicit_user',
      category: 'styling',
      statement: 'Prefer Tailwind CSS utility classes globally'
    });
    assert.equal(globalPref.verification_status, 'approved');

    recordMemory(projDb, {
      scope: 'project',
      project_id: proj.id,
      type: 'explicit_preference',
      source_type: 'explicit_user',
      category: 'styling',
      statement: 'Use CSS Modules instead in this legacy repository'
    });

    const resolved = retrieveRelevantMemories({ projectDb: projDb, globalDb, projectId: proj.id, profileId: 'web', query: 'styling Tailwind CSS' });
    assert.equal(resolved.overridden.length, 1);
    assert.equal(resolved.overridden[0].id, globalPref.id);
    assert.ok(resolved.items.some(m => m.statement.includes('CSS Modules')));

    // Deduplication and near-duplicate consolidation
    recordMemory(projDb, { scope: 'project', project_id: proj.id, category: 'testing', statement: 'Always run pytest on isolated SQLite fixtures' });
    recordMemory(projDb, { scope: 'project', project_id: proj.id, category: 'testing', statement: 'Always   run pytest on isolated sqlite fixtures' });
    recordMemory(projDb, { scope: 'project', project_id: proj.id, category: 'testing', statement: 'Always run pytest against isolated SQLite fixtures' });
    const cons = consolidateMemories(projDb, { projectId: proj.id });
    assert.equal(cons.consolidated_count, 1);

    // Disable & delete
    const dis = disableMemory(projDb, unverified.id);
    assert.equal(dis.status, 'disabled');
    deleteMemory(projDb, unverified.id);
    assert.equal(projDb.getMemory(unverified.id), null);

    // Encrypted export + import round-trip
    const exportPath = join(root, 'backup.enc.json');
    const exp = exportMemories(globalDb, { filePath: exportPath, scope: 'global', passphrase: 'strong-passphrase-test' });
    assert.equal(exp.encrypted, true);
    assert.throws(() => importMemories(targetDb, exportPath, { passphrase: 'wrong-passphrase' }));
    const imp = importMemories(targetDb, exportPath, { passphrase: 'strong-passphrase-test' });
    assert.equal(imp.imported_count, 1);

    // Improvement proposal check from repeated blocked gate runs
    projDb.recordGateRun(proj.id, { config_hash: 'h1', ok: false, results: [{ name: 'typecheck', ok: false }] }, {});
    projDb.recordGateRun(proj.id, { config_hash: 'h1', ok: false, results: [{ name: 'typecheck', ok: false }] }, {});
    const propRes = proposeImprovements({ projectDb: projDb, projectId: proj.id });
    assert.ok(propRes.proposals.some(p => p.title.includes('typecheck')));
    syncProjectMemoryViews(projPath, projDb, proj.id);
    assert.ok(existsSync(join(projPath, '.factory', 'memory', 'lessons.md')));
  } finally {
    projDb.close();
    globalDb.close();
    targetDb.close();
  }
});

test('SQLite v0.2.0 schema migrates forward to v2 without losing existing tasks or projects', t => {
  const root = makeTempDir(t);
  const dbPath = join(root, 'legacy-v02.db');
  const raw = new DatabaseSync(dbPath);
  raw.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, adapter_ids TEXT NOT NULL DEFAULT '[]', config_json TEXT NOT NULL, config_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, pipeline_id TEXT, title TEXT NOT NULL, criteria TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'implementation', agent_role TEXT NOT NULL DEFAULT 'backend', status TEXT NOT NULL DEFAULT 'queued', priority INTEGER NOT NULL DEFAULT 50, depends_on_json TEXT NOT NULL DEFAULT '[]', branch TEXT, worktree TEXT, attempts INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL DEFAULT 2, lease_owner TEXT, lease_expires_at TEXT, last_error TEXT, verification_json TEXT, approval_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO projects VALUES ('p1', 'legacy-app', '${root.replaceAll('\\', '\\\\')}', '["node"]', '{}', 'h1', '2026-01-01', '2026-01-01');
    INSERT INTO tasks (id, project_id, title, criteria, created_at, updated_at) VALUES ('t-old-1', 'p1', 'Pre-existing task', 'Keep safe', '2026-01-01', '2026-01-01');
  `);
  raw.close();

  const migrated = openFactoryDb(dbPath);
  try {
    assert.equal(migrated.schemaVersion(), 2);
    assert.equal(migrated.getProject('p1').name, 'legacy-app');
    assert.equal(migrated.getTask('t-old-1').title, 'Pre-existing task');
    const m = recordMemory(migrated, { scope: 'project', project_id: 'p1', category: 'engineering', statement: 'Migrated DB supports memories' });
    assert.ok(m.id);
  } finally {
    migrated.close();
  }
});
