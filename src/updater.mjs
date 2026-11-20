import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultGlobalHome, openFactoryDb } from './db.mjs';
import { generateAgentAdapters } from './agent-registry.mjs';
import { safeSpawn } from './security.mjs';

const DEFAULT_FACTORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = () => new Date().toISOString();

export const MANAGED_ROOT_ENTRIES = [
  'package.json',
  'bin/factory.mjs',
  'src',
  'installer',
  '.agents',
  '.cursor/rules',
  '.cursor/agents'
];

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function collectFilesInEntry(rootDir, relEntry, out = []) {
  const full = join(rootDir, relEntry);
  if (!existsSync(full)) return out;
  const entries = readdirSync(full, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules' || e.isSymbolicLink()) continue;
    const rel = `${relEntry}/${e.name}`;
    const p = join(rootDir, rel);
    if (e.isDirectory()) collectFilesInEntry(rootDir, rel, out);
    else if (e.isFile()) out.push(rel.replace(/\\/g, '/'));
  }
  return out;
}

/** Build a SHA-256 manifest of factory-managed paths inside a factory installation directory. */
export function buildManagedManifest(rootDir) {
  const root = resolve(rootDir);
  const files = {};
  for (const entry of MANAGED_ROOT_ENTRIES) {
    const abs = join(root, entry);
    if (!existsSync(abs)) continue;
    if (entry.endsWith('.json') || entry.endsWith('.mjs')) {
      files[entry] = sha256File(abs);
    } else {
      for (const rel of collectFilesInEntry(root, entry)) {
        files[rel] = sha256File(join(root, rel));
      }
    }
  }
  let version = 'unknown';
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try { version = JSON.parse(readFileSync(pkgPath, 'utf8')).version || 'unknown'; } catch {}
  }
  return { schema: 1, version, generated_at: stamp(), files };
}

export function readManagedManifest(rootDir, fileName = '.factory-manifest.json') {
  const p = join(resolve(rootDir), fileName);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function writeManagedManifest(rootDir, manifest = null, fileName = '.factory-manifest.json') {
  const root = resolve(rootDir);
  const data = manifest || buildManagedManifest(root);
  const p = join(root, fileName);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return data;
}

function copyDirClean(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) copyDirClean(s, d);
    else if (entry.isFile()) copyFileSync(s, d);
  }
}

function gitSafe(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function restoreFromBackup(targetDir, backupDir, dbPath = null) {
  const root = resolve(targetDir);
  const filesRoot = join(backupDir, 'files');
  const addedJson = join(backupDir, 'added-files.json');

  if (existsSync(addedJson)) {
    const added = JSON.parse(readFileSync(addedJson, 'utf8'));
    for (const rel of added) {
      const p = join(root, rel);
      if (existsSync(p)) rmSync(p, { force: true });
    }
  }

  if (existsSync(filesRoot)) {
    function walk(d, prefix = '') {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        const s = join(d, e.name);
        if (e.isDirectory()) walk(s, rel);
        else if (e.isFile()) {
          const dst = join(root, rel);
          mkdirSync(dirname(dst), { recursive: true });
          copyFileSync(s, dst);
        }
      }
    }
    walk(filesRoot);
  }

  const prevManifestBak = join(backupDir, '.factory-manifest.json');
  if (existsSync(prevManifestBak)) {
    copyFileSync(prevManifestBak, join(root, '.factory-manifest.json'));
  }

  const dbBak = join(backupDir, 'db.sqlite.bak');
  if (dbPath && existsSync(dbBak)) {
    mkdirSync(dirname(dbPath), { recursive: true });
    copyFileSync(dbBak, dbPath);
  }
}

/** Recover from an interrupted prior update using .factory-update-in-progress.json journal. */
export function recoverInterruptedUpdate(targetDir, { dbPath = null } = {}) {
  const root = resolve(targetDir);
  const journalPath = join(root, '.factory-update-in-progress.json');
  if (!existsSync(journalPath)) return { recovered: false };
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  if (journal.backup_path && existsSync(journal.backup_path)) {
    restoreFromBackup(root, journal.backup_path, dbPath || journal.db_path || null);
  }
  rmSync(journalPath, { force: true });
  return { recovered: true, backup_path: journal.backup_path, from_version: journal.from_version };
}

/** Resolve update source (local folder or Git remote) into an isolated staging directory. */
function stageUpdateSource(source, targetDir) {
  const stageDir = mkdtempSync(join(tmpdir(), 'factory-update-stage-'));
  let sourceRef = source;
  if (!sourceRef) {
    const remote = gitSafe(targetDir, ['remote', 'get-url', 'origin']);
    if (!remote) {
      rmSync(stageDir, { recursive: true, force: true });
      throw new Error('No update source provided and target directory has no git origin remote. Pass --source <path-or-url>.');
    }
    sourceRef = remote;
  }

  try {
    if (existsSync(sourceRef) && !existsSync(join(sourceRef, '.git'))) {
      copyDirClean(resolve(sourceRef), stageDir);
    } else if (existsSync(sourceRef) && existsSync(join(sourceRef, '.git'))) {
      const urlOrPath = resolve(sourceRef);
      execFileSync('git', ['clone', '--quiet', '--depth', '1', urlOrPath, stageDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } else {
      execFileSync('git', ['clone', '--quiet', '--depth', '1', String(sourceRef), stageDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    }

    const pkgPath = join(stageDir, 'package.json');
    const cliPath = join(stageDir, 'bin', 'factory.mjs');
    if (!existsSync(pkgPath) || !existsSync(cliPath)) {
      throw new Error('Invalid factory update payload: missing package.json or bin/factory.mjs');
    }
    JSON.parse(readFileSync(pkgPath, 'utf8'));
    const syntax = safeSpawn(process.execPath, ['--check', cliPath], { cwd: stageDir });
    if (!syntax.ok) {
      throw new Error(`Update payload failed syntax check: ${syntax.stderr || syntax.error}`);
    }

    const toVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version || 'unknown';
    const toCommit = gitSafe(stageDir, ['rev-parse', 'HEAD']) || 'local';
    return { stageDir, sourceRef, toVersion, toCommit };
  } catch (err) {
    rmSync(stageDir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Safely check, dry-run, apply, or roll back a Myfactory installation update.
 * Preserves user-customized files, respects dirty Git working trees, creates backups,
 * runs migrations, and rolls back automatically on failure.
 */
export function updateFactory({
  targetDir = DEFAULT_FACTORY_ROOT,
  source = null,
  check = false,
  dryRun = false,
  yes = false,
  force = false,
  rollback = false,
  rollbackId = null,
  db = null,
  globalHome = null,
  simulateFailureStep = null
} = {}) {
  const root = resolve(targetDir);
  const home = resolve(globalHome || defaultGlobalHome());
  const backupRoot = join(home, 'backups');
  const resolvedDbPath = db?.path || join(home, 'factory.db');

  // Auto-recover interrupted update first if a crash left a journal behind
  const priorRecovery = recoverInterruptedUpdate(root, { dbPath: db ? null : resolvedDbPath });

  if (rollback) {
    if (!existsSync(backupRoot)) throw new Error(`No backups found in ${backupRoot}`);
    const backups = readdirSync(backupRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse();
    const chosen = rollbackId ? backups.find(b => b.includes(rollbackId)) : backups[0];
    if (!chosen) throw new Error(`No matching backup found for rollback (${rollbackId || 'latest'})`);
    const backupDir = join(backupRoot, chosen);
    if (db) db.checkpoint();
    restoreFromBackup(root, backupDir, null);
    if (db) {
      db.recordUpdateEvent({
        action: 'rollback',
        status: 'rolled_back',
        backup_path: backupDir,
        details: { prior_recovery: priorRecovery }
      });
    }
    return { ok: true, action: 'rollback', restored_from: backupDir, prior_recovery: priorRecovery };
  }

  const fromVersion = existsSync(join(root, 'package.json'))
    ? (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || 'unknown')
    : 'unknown';
  const fromCommit = gitSafe(root, ['rev-parse', 'HEAD']) || 'local';
  const gitDirtyLines = existsSync(join(root, '.git'))
    ? (gitSafe(root, ['status', '--porcelain']) || '').split(/\r?\n/).filter(l => l.trim() && !l.includes('.factory-manifest.json') && !l.includes('.factory-update-in-progress.json'))
    : [];
  const dirtyGit = gitDirtyLines.length > 0;

  if (dirtyGit && !check && !dryRun) {
    throw new Error(`Modified Git working tree detected in ${root}. Commit or stash changes before applying update.`);
  }

  const { stageDir, sourceRef, toVersion, toCommit } = stageUpdateSource(source, root);
  try {
    const prevManifest = readManagedManifest(root);
    const incomingManifest = buildManagedManifest(stageDir);

    const plannedUpdates = [];
    const plannedAdds = [];
    const preservedCustom = [];
    const unchanged = [];

    for (const [rel, inHash] of Object.entries(incomingManifest.files)) {
      const dst = join(root, rel);
      if (!existsSync(dst)) {
        plannedAdds.push(rel);
        continue;
      }
      const curHash = sha256File(dst);
      if (curHash === inHash) {
        unchanged.push(rel);
        continue;
      }
      const prevHash = prevManifest?.files?.[rel];
      const looksUserOwned = /(?:^|[\\/])(custom-|user-)/i.test(rel);
      if ((prevHash && curHash !== prevHash) || looksUserOwned) {
        // User customized a managed or user-named file: preserve even if --force is passed
        preservedCustom.push(rel);
      } else {
        plannedUpdates.push(rel);
      }
    }

    const report = {
      ok: true,
      action: check ? 'check' : (dryRun ? 'dry_run' : 'update'),
      target_dir: root,
      source: sourceRef,
      from_version: fromVersion,
      to_version: toVersion,
      from_commit: fromCommit,
      to_commit: toCommit,
      update_available: fromVersion !== toVersion || fromCommit !== toCommit || plannedUpdates.length > 0 || plannedAdds.length > 0,
      dirty_git: dirtyGit,
      force_flag_respected_custom: force,
      planned_adds: plannedAdds,
      planned_updates: plannedUpdates,
      preserved_custom: preservedCustom,
      unchanged_count: unchanged.length,
      prior_recovery: priorRecovery
    };

    if (check || dryRun) {
      return report;
    }

    const backupId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${fromVersion}-${randomUUID().slice(0, 6)}`;
    const backupDir = join(backupRoot, backupId);
    mkdirSync(join(backupDir, 'files'), { recursive: true });

    for (const rel of plannedUpdates) {
      const src = join(root, rel);
      const dst = join(backupDir, 'files', rel);
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    }
    if (existsSync(join(root, '.factory-manifest.json'))) {
      copyFileSync(join(root, '.factory-manifest.json'), join(backupDir, '.factory-manifest.json'));
    }
    if (existsSync(resolvedDbPath)) {
      if (db) db.checkpoint();
      copyFileSync(resolvedDbPath, join(backupDir, 'db.sqlite.bak'));
    }
    writeFileSync(join(backupDir, 'added-files.json'), JSON.stringify(plannedAdds, null, 2), 'utf8');

    const journalPath = join(root, '.factory-update-in-progress.json');
    writeFileSync(journalPath, JSON.stringify({
      started_at: stamp(),
      from_version: fromVersion,
      to_version: toVersion,
      backup_path: backupDir,
      db_path: resolvedDbPath
    }, null, 2), 'utf8');

    try {
      for (const rel of [...plannedAdds, ...plannedUpdates]) {
        const src = join(stageDir, rel);
        const dst = join(root, rel);
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      }

      if (simulateFailureStep === 'after_copy') {
        throw new Error('Simulated update failure after file copy');
      }

      // Update manifest retaining hashes for preserved customized files so future updates continue preserving them
      const nextManifestFiles = { ...incomingManifest.files };
      for (const rel of preservedCustom) {
        if (prevManifest?.files?.[rel]) nextManifestFiles[rel] = prevManifest.files[rel];
      }
      writeManagedManifest(root, { schema: 1, version: toVersion, generated_at: stamp(), files: nextManifestFiles });

      if (existsSync(join(root, 'src', 'agent-registry.mjs'))) {
        generateAgentAdapters(root, { preserveCustom: true });
      }

      // Run DB migration & CLI smoke check
      let schemaVersion = null;
      if (db) {
        schemaVersion = db.schemaVersion();
      } else {
        const tmpDb = openFactoryDb(resolvedDbPath);
        try { schemaVersion = tmpDb.schemaVersion(); } finally { tmpDb.close(); }
      }

      const smoke = safeSpawn(process.execPath, [join(root, 'bin', 'factory.mjs'), 'version'], { cwd: root });
      if (!smoke.ok) {
        throw new Error(`Post-update CLI smoke test failed: ${smoke.stderr || smoke.error}`);
      }
      if (simulateFailureStep === 'smoke_check') {
        throw new Error('Simulated post-update smoke test failure');
      }

      rmSync(journalPath, { force: true });
      if (db) {
        db.recordUpdateEvent({
          from_version: fromVersion,
          to_version: toVersion,
          from_commit: fromCommit,
          to_commit: toCommit,
          action: 'update',
          status: 'completed',
          backup_path: backupDir,
          details: { added: plannedAdds.length, updated: plannedUpdates.length, preserved_custom: preservedCustom.length, yes }
        });
      }

      return {
        ...report,
        status: 'updated',
        schema_version: schemaVersion,
        backup_path: backupDir,
        applied_count: plannedAdds.length + plannedUpdates.length
      };
    } catch (err) {
      restoreFromBackup(root, backupDir, db ? null : resolvedDbPath);
      rmSync(journalPath, { force: true });
      if (db) {
        db.recordUpdateEvent({
          from_version: fromVersion,
          to_version: toVersion,
          from_commit: fromCommit,
          to_commit: toCommit,
          action: 'update',
          status: 'rolled_back',
          backup_path: backupDir,
          details: { error: err.message }
        });
      }
      return {
        ...report,
        ok: false,
        status: 'rolled_back',
        rolled_back: true,
        error: err.message,
        backup_path: backupDir
      };
    }
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

function simpleLineDiffPreview(currentText, incomingText, maxLines = 12) {
  const cur = String(currentText).split(/\r?\n/);
  const inc = String(incomingText).split(/\r?\n/);
  const out = [];
  const limit = Math.max(cur.length, inc.length);
  for (let i = 0; i < limit && out.length < maxLines; i++) {
    if (cur[i] !== inc[i]) {
      if (cur[i] !== undefined) out.push(`- ${cur[i]}`);
      if (inc[i] !== undefined) out.push(`+ ${inc[i]}`);
    }
  }
  return out.join('\n');
}

/**
 * Synchronize updated factory-managed agents/rules/core skills into an existing initialized project
 * without duplicating unrelated global skills or overwriting project customizations.
 */
export function syncProject({
  projectPath = '.',
  factoryRoot = DEFAULT_FACTORY_ROOT,
  dryRun = false,
  skills = false
} = {}) {
  const proj = resolve(projectPath);
  const srcRoot = resolve(factoryRoot);
  const syncManifestPath = join(proj, '.factory', 'sync-manifest.json');
  const prevSync = existsSync(syncManifestPath)
    ? JSON.parse(readFileSync(syncManifestPath, 'utf8'))
    : { schema: 1, files: {} };

  // Core managed files only (never blindly copy optional unrelated skills into every repo)
  const syncCandidates = new Map();
  const addPair = (relSrc, relDst = relSrc) => {
    const abs = join(srcRoot, relSrc);
    if (existsSync(abs)) syncCandidates.set(relDst, abs);
  };

  addPair('.agent/README.md');
  addPair('.agents/rules/factory-quality.md');
  addPair('.cursor/rules/factory-quality.mdc');

  for (const wfDir of ['.agents/workflows']) {
    if (existsSync(join(srcRoot, wfDir))) {
      for (const f of readdirSync(join(srcRoot, wfDir))) {
        if (f.endsWith('.md')) addPair(`${wfDir}/${f}`);
      }
    }
  }

  // Core factory-* skills + generated agent adapters
  if (existsSync(join(srcRoot, '.agents', 'skills'))) {
    for (const sk of readdirSync(join(srcRoot, '.agents', 'skills'), { withFileTypes: true })) {
      if (!sk.isDirectory()) continue;
      if (!sk.name.startsWith('factory-') && !skills) continue;
      for (const rel of collectFilesInEntry(srcRoot, `.agents/skills/${sk.name}`)) {
        addPair(rel);
        addPair(rel, rel.replace(/^\.agents\/skills\//, '.cursor/skills/'));
      }
    }
  }

  for (const dir of ['.agents/agents', '.cursor/agents']) {
    if (existsSync(join(srcRoot, dir))) {
      for (const rel of collectFilesInEntry(srcRoot, dir)) addPair(rel);
    }
  }

  const added = [];
  const updated = [];
  const conflicts = [];
  const unchanged = [];
  const nextHashes = { ...(prevSync.files || {}) };

  for (const [relDst, absSrc] of syncCandidates.entries()) {
    const absDst = join(proj, relDst);
    const inHash = sha256File(absSrc);
    if (!existsSync(absDst)) {
      added.push(relDst);
      if (!dryRun) {
        mkdirSync(dirname(absDst), { recursive: true });
        copyFileSync(absSrc, absDst);
        nextHashes[relDst] = inHash;
      }
      continue;
    }

    const curHash = sha256File(absDst);
    if (curHash === inHash) {
      unchanged.push(relDst);
      nextHashes[relDst] = curHash;
      continue;
    }

    const knownHash = prevSync.files?.[relDst];
    if (knownHash && curHash === knownHash) {
      updated.push(relDst);
      if (!dryRun) {
        mkdirSync(dirname(absDst), { recursive: true });
        copyFileSync(absSrc, absDst);
        nextHashes[relDst] = inHash;
      }
    } else {
      conflicts.push({
        file: relDst,
        status: 'conflict_preserved',
        preview_diff: simpleLineDiffPreview(readFileSync(absDst, 'utf8'), readFileSync(absSrc, 'utf8'))
      });
    }
  }

  const srcVersion = existsSync(join(srcRoot, 'package.json'))
    ? (JSON.parse(readFileSync(join(srcRoot, 'package.json'), 'utf8')).version || '1.0.0')
    : '1.0.0';

  if (!dryRun && existsSync(join(proj, '.factory'))) {
    writeFileSync(syncManifestPath, JSON.stringify({
      schema: 1,
      factory_version: srcVersion,
      synced_at: stamp(),
      files: nextHashes
    }, null, 2) + '\n', 'utf8');
  }

  return {
    ok: true,
    project: proj,
    dry_run: dryRun,
    factory_version: srcVersion,
    added_count: added.length,
    updated_count: updated.length,
    conflict_count: conflicts.length,
    unchanged_count: unchanged.length,
    added,
    updated,
    conflicts
  };
}
