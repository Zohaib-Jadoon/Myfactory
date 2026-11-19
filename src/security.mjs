import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

const WIN_CMD_SHIMS = new Set(['npm', 'pnpm', 'yarn', 'npx', 'flutter', 'dart', 'az', 'mvn', 'gradle']);

const SECRET_FILENAME_RE = /(^|[\\/])(\.env(?:\.[^\\/]+)?|id_rsa|id_ed25519|id_ecdsa|credentials\.json|service[-_]?account[^\\/]*\.json|[^\\/]+\.(?:pem|p12|pfx|key))$/i;
const ENV_EXAMPLE_RE = /(^|[\\/])\.env\.(?:example|sample|template)$/i;

const SECRET_CONTENT_PATTERNS = [
  { id: 'private-key', severity: 'critical', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', severity: 'critical', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', severity: 'critical', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { id: 'google-api-key', severity: 'high', re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { id: 'stripe-live-key', severity: 'critical', re: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/ },
  { id: 'slack-token', severity: 'high', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: 'openai-anthropic-key', severity: 'critical', re: /\bsk-(?:ant-api\d*-|proj-)[A-Za-z0-9\-_]{20,}\b/ },
  { id: 'db-url-password', severity: 'high', re: /\b(?:postgres(?:ql)?|mysql|mssql|sqlserver|mongodb(?:\+srv)?|redis):\/\/[^:\s/]+:([^@\s]{4,})@/i },
  { id: 'conn-string-password', severity: 'high', re: /(?:^|[;\s])(?:Password|Pwd)\s*=\s*([^;\s"']{4,})/i }
];

const SKIP_DIRS = new Set(['.git', '.factory', 'node_modules', '.next', 'dist', 'build', 'coverage', '.dart_tool', '__pycache__', '.venv', 'venv', 'bin', 'obj']);
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.dylib', '.bin', '.woff', '.woff2', '.ttf', '.db', '.sqlite', '.sqlite3', '.lock']);

/** Redact known secret and credential patterns before logging or persisting output. */
export function redactSecrets(input) {
  if (input == null) return '';
  let text = String(input);
  text = text.replace(/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END [^\n-]+-----/g, '[REDACTED_PRIVATE_KEY]');
  text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]');
  text = text.replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, '[REDACTED_GITHUB_TOKEN]');
  text = text.replace(/\bAIza[0-9A-Za-z\-_]{35}\b/g, '[REDACTED_GOOGLE_KEY]');
  text = text.replace(/\b[rs]k_live_[0-9A-Za-z]{20,}\b/g, '[REDACTED_STRIPE_KEY]');
  text = text.replace(/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]');
  text = text.replace(/\bsk-(?:ant-api\d*-|proj-)[A-Za-z0-9\-_]{20,}\b/g, '[REDACTED_API_KEY]');
  text = text.replace(/(\b(?:postgres(?:ql)?|mysql|mssql|sqlserver|mongodb(?:\+srv)?|redis):\/\/[^:\s/]+:)([^@\s]+)(@)/gi, '$1[REDACTED]$3');
  text = text.replace(/(\b(?:Password|Pwd|API_KEY|SECRET_KEY|TOKEN|ACCESS_TOKEN)\s*[:=]\s*["']?)([^"'\s;\r\n]{4,})/gi, '$1[REDACTED]');
  text = text.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]');
  return text;
}

/** Verify that targetPath stays strictly inside root, preventing traversal and symlink escapes. */
export function assertInsideRoot(root, targetPath) {
  const absRoot = existsSync(root) ? realpathSync(root) : resolve(root);
  const absTarget = resolve(absRoot, targetPath || '.');
  const rel = relative(absRoot, absTarget);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error(`Path escapes project boundary: ${targetPath}`);
  }
  if (existsSync(absTarget)) {
    const realTarget = realpathSync(absTarget);
    const realRel = relative(absRoot, realTarget);
    if (realRel === '..' || realRel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(realRel)) {
      throw new Error(`Symlink escapes project boundary: ${targetPath}`);
    }
  }
  return absTarget;
}

function quoteWinCmdArg(arg) {
  const s = String(arg);
  if (!/[\s"&|<>^()%!]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Execute a subprocess without Node DEP0190 shell-args warnings and redact output secrets. */
export function safeSpawn(command, args = [], options = {}) {
  const { cwd = process.cwd(), timeout = 180000, env = process.env, maxBuffer = 2 * 1024 * 1024 } = options;
  const cleanEnv = { ...env, CI: env.CI ?? 'true' };
  const isWinShim = process.platform === 'win32' && (WIN_CMD_SHIMS.has(command.toLowerCase()) || /\.(cmd|bat)$/i.test(command));

  let proc;
  if (isWinShim) {
    const cmdLine = [command, ...args].map(quoteWinCmdArg).join(' ');
    const comspec = process.env.ComSpec || 'cmd.exe';
    proc = spawnSync(comspec, ['/d', '/s', '/c', `"${cmdLine}"`], {
      cwd,
      encoding: 'utf8',
      timeout,
      env: cleanEnv,
      windowsVerbatimArguments: true,
      maxBuffer
    });
  } else {
    proc = spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      timeout,
      env: cleanEnv,
      maxBuffer
    });
  }

  return {
    ok: !proc.error && proc.status === 0,
    status: proc.status,
    error: proc.error ? redactSecrets(proc.error.message) : null,
    stdout: redactSecrets(proc.stdout || ''),
    stderr: redactSecrets(proc.stderr || '')
  };
}

/** List tracked Git files if repo exists, otherwise walk workspace safely within boundary. */
function collectScanFiles(repoPath) {
  const tracked = [];
  if (existsSync(join(repoPath, '.git'))) {
    try {
      const out = execFileSync('git', ['ls-files'], { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      for (const rel of out.split(/\r?\n/)) {
        if (rel.trim()) tracked.push(rel.trim());
      }
      return { isGit: true, files: tracked };
    } catch {
      // Fallback to directory walk if git ls-files fails on empty/corrupt repo.
    }
  }
  const files = [];
  function walk(dir, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) files.push(rel);
    }
  }
  walk(repoPath);
  return { isGit: false, files };
}

/** Scan tracked filenames and file contents for secrets without ever emitting raw secret values. */
export function scanSecrets(repoPath) {
  const root = resolve(repoPath);
  const { isGit, files } = collectScanFiles(root);
  const trackedSecretFiles = [];
  const findings = [];

  for (const rel of files) {
    if (SECRET_FILENAME_RE.test(rel) && !ENV_EXAMPLE_RE.test(rel)) {
      trackedSecretFiles.push(rel);
      findings.push({
        severity: 'critical',
        category: 'sensitive-file',
        file: rel,
        line: 0,
        summary: `Sensitive credential filename present${isGit ? ' in Git index' : ''}: ${rel}`
      });
    }
    if (BINARY_EXTS.has(extname(rel).toLowerCase())) continue;
    const full = join(root, rel);
    if (!existsSync(full)) continue;
    let stat;
    try { stat = lstatSync(full); } catch { continue; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) continue;

    let content;
    try { content = readFileSync(full, 'utf8'); } catch { continue; }
    if (content.includes('\u0000')) continue;

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\[REDACTED/i.test(line) || /\b(?:changeme|your[-_](?:token|api[-_]?key|secret|password)|<your[_-])/i.test(line)) continue;
      for (const rule of SECRET_CONTENT_PATTERNS) {
        if (rule.re.test(line)) {
          findings.push({
            severity: rule.severity,
            category: rule.id,
            file: rel,
            line: i + 1,
            summary: `Potential ${rule.id} detected (redacted)`
          });
        }
      }
    }
  }

  return {
    ok: findings.length === 0,
    isGit,
    filesScanned: files.length,
    trackedSecretFiles,
    findings
  };
}

/** Enforce non-overridable factory safety defaults against untrusted repository configs. */
export function enforceSafetyPolicy(rawConfig = {}) {
  return {
    ...rawConfig,
    human_approval_required: true,
    automatic_deployment: false,
    allow_outside_root: false
  };
}
