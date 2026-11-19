import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { assertInsideRoot, enforceSafetyPolicy, redactSecrets, safeSpawn, scanSecrets } from './security.mjs';

const stamp = () => new Date().toISOString();

function putJson(filePath, obj) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function hashProjectConfig(projectPath) {
  const cfgPath = join(projectPath, '.factory', 'config.json');
  return createHash('sha256').update(readFileSync(cfgPath)).digest('hex');
}

function gitHead(cwd) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function gitDirty(cwd) {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).length > 0;
  } catch {
    return true;
  }
}

/** Run configured quality gates, secret scans, and measurable metrics against a project or task worktree. */
export function runQualityGates({ projectPath, task = null, db = null, projectId = null }) {
  const root = resolve(projectPath);
  const runPath = task?.worktree && existsSync(task.worktree) ? resolve(task.worktree) : root;
  const rawCfg = readJson(join(root, '.factory', 'config.json'), {});
  const cfg = enforceSafetyPolicy(rawCfg);
  const checks = cfg.required_checks;
  if (!Array.isArray(checks)) throw new Error('required_checks must be an array');

  const results = [];
  const sec = scanSecrets(runPath);

  results.push({
    name: 'tracked-secret-files',
    status: sec.trackedSecretFiles.length === 0 ? 'PASS' : 'FAIL',
    ok: sec.trackedSecretFiles.length === 0,
    detail: sec.trackedSecretFiles.length
      ? `Potential secrets tracked: ${sec.trackedSecretFiles.join(', ')}`
      : 'No typical secret filenames tracked by Git or workspace'
  });

  const contentFindings = sec.findings.filter(f => f.category !== 'sensitive-file');
  results.push({
    name: 'secret-content-scan',
    status: contentFindings.length === 0 ? 'PASS' : 'FAIL',
    ok: contentFindings.length === 0,
    detail: contentFindings.length
      ? contentFindings.map(f => `${f.severity.toUpperCase()} ${f.category} at ${f.file}:${f.line}`).join('; ')
      : `Scanned ${sec.filesScanned} file(s); 0 secret patterns matched`
  });

  if (checks.length === 0) {
    results.push({
      name: 'required-checks-configured',
      status: 'NOT VERIFIED',
      ok: false,
      detail: 'No automated checks configured. Add explicit required_checks to .factory/config.json. Empty checklists cannot pass.'
    });
  }

  for (const check of checks) {
    const started = Date.now();
    if (!check.name || !check.command || !Array.isArray(check.args)) {
      results.push({ name: check.name || 'unnamed', status: 'FAIL', ok: false, detail: 'Invalid gate configuration' });
      continue;
    }

    let cwd;
    try {
      cwd = assertInsideRoot(runPath, check.cwd || '.');
      if (!existsSync(cwd)) throw new Error('Working directory missing');
    } catch {
      results.push({ name: check.name, status: 'FAIL', ok: false, detail: 'Invalid or out-of-worktree check.cwd' });
      continue;
    }

    const proc = safeSpawn(check.command, check.args, { cwd, timeout: 180000 });
    const missingBin = Boolean(proc.error && /ENOENT/i.test(proc.error));
    const status = proc.ok ? 'PASS' : (missingBin ? 'NOT VERIFIED' : 'FAIL');
    results.push({
      name: check.name,
      status,
      ok: proc.ok,
      exit_code: proc.status,
      elapsed_ms: Date.now() - started,
      detail: redactSecrets(proc.error || `${proc.stdout}\n${proc.stderr}`.trim()).slice(-5000)
    });
  }

  const revision = gitHead(runPath);
  const dirty = gitDirty(runPath);
  const configHash = hashProjectConfig(root);
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok && r.status !== 'NOT VERIFIED').length;
  const notVerified = results.filter(r => r.status === 'NOT VERIFIED').length;
  const metrics = {
    total_gates: results.length,
    passed_gates: passed,
    failed_gates: failed,
    not_verified_gates: notVerified,
    gate_pass_rate: results.length ? Number(((passed / results.length) * 100).toFixed(2)) : 0,
    secret_findings: sec.findings.length,
    files_scanned: sec.filesScanned
  };

  const report = {
    at: stamp(),
    project: root,
    run_path: runPath,
    task_id: task?.id || null,
    revision,
    dirty,
    config_hash: configHash,
    ok: results.length > 0 && results.every(r => r.ok),
    metrics,
    results
  };

  const reportPath = join(root, '.factory', 'reports', `${task?.id || 'project'}-latest.json`);
  putJson(reportPath, report);

  if (db && projectId) {
    db.replaceOpenSecurityFindings(projectId, task?.id || null, sec.findings);
    const gateRunId = db.recordGateRun(projectId, report, metrics);
    report.gate_run_id = gateRunId;
  }
  report.reportPath = reportPath;
  return report;
}

