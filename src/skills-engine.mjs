import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectProjectStack } from './adapters.mjs';
import { detectProjectProfile } from './profiles.mjs';
import { safeSpawn, scanSecrets } from './security.mjs';

const DEFAULT_FACTORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'skill-allowlist.json');

export const KNOWN_SKILL_SOURCES = [
  'https://skills.sh/',
  'https://github.com/vercel-labs/skills',
  'https://github.com/vercel-labs/agent-skills',
  'https://github.com/anthropics/skills',
  'https://github.com/backnotprop/pstack',
  'https://github.com/DietrichGebert/ponytail'
];

export const CURATED_SKILL_CATALOG = [
  { name: 'eng-architecture', source: 'local-bundled', repo: 'Myfactory/bundled', description: 'Modular architecture, API contracts, ADRs, backward compatibility', stacks: ['node', 'nextjs', 'nestjs', 'python', 'dotnet', 'generic'], profiles: ['web', 'enterprise', 'generic'], license: 'MIT' },
  { name: 'eng-frontend', source: 'local-bundled', repo: 'Myfactory/bundled', description: 'React 19, Next.js 14-16, TypeScript, Tailwind CSS v4, WCAG 2.2 AA accessibility', stacks: ['nextjs', 'react'], profiles: ['web', 'enterprise'], license: 'MIT' },
  { name: 'eng-backend', source: 'local-bundled', repo: 'Myfactory/bundled', description: 'REST APIs, DTO validation, RBAC, multi-tenancy, transactions, idempotency, observability', stacks: ['nestjs', 'node', 'python', 'dotnet', 'iot'], profiles: ['web', 'enterprise', 'iot', 'mobile'], license: 'MIT' },
  { name: 'eng-databases', source: 'local-bundled', repo: 'Myfactory/bundled', description: 'PostgreSQL, Neon, Prisma, SQL Server T-SQL migrations, indexes, integrity tests', stacks: ['postgres', 'prisma', 'sqlserver'], profiles: ['web', 'legacy', 'enterprise', 'iot'], license: 'MIT' },
  { name: 'eng-mobile', source: 'local-bundled', repo: 'Myfactory/bundled', description: 'Expo, React Native, Flutter permissions, offline queue, camera/GPS, APK builds', stacks: ['expo', 'flutter'], profiles: ['mobile'], license: 'MIT' },
  { name: 'eng-desktop', source: 'local-bundled', repo: 'Myfactory/bundled', description: 'Electron contextIsolation, IPC validation, Windows installers, packaged startup verification', stacks: ['desktop'], profiles: ['desktop'], license: 'MIT' },
  { name: 'eng-ai-biometrics', source: 'local-bundled', repo: 'Myfactory/bundled', description: 'Face verification, liveness anti-spoofing, FAR/FRR evals, privacy & OS vs external fingerprint separation', stacks: ['ai_ml', 'biometrics'], profiles: ['ai'], license: 'MIT' },
  { name: 'eng-games', source: 'local-bundled', repo: 'Myfactory/bundled', description: 'Unity C#, Unreal C++, Godot GDScript deterministic loops, asset pipelines, frame budgets', stacks: ['unity', 'unreal', 'godot'], profiles: ['game'], license: 'MIT' },
  { name: 'eng-quality', source: 'local-bundled', repo: 'Myfactory/bundled', description: 'Unit, integration, contract, E2E, security, performance, and release gate verification', stacks: ['node', 'nextjs', 'nestjs', 'python', 'dotnet', 'expo', 'flutter', 'unity', 'godot', 'generic'], profiles: ['web', 'mobile', 'ai', 'iot', 'legacy', 'desktop', 'enterprise', 'game', 'generic'], license: 'MIT' },
  { name: 'eng-deployment', source: 'local-bundled', repo: 'Myfactory/bundled', description: 'Vercel, Render, Koyeb, Windows IIS, Docker, CI/CD, health probes, and rollback plans', stacks: ['docker', 'iis_asp', 'nextjs', 'nestjs', 'dotnet'], profiles: ['web', 'legacy', 'iot', 'enterprise', 'desktop'], license: 'MIT' },
  { name: 'poteto-mode', source: 'https://github.com/backnotprop/pstack.git', repo: 'backnotprop/pstack', description: 'Engineering rigor, foundational thinking, root-cause fixes, independent verification', stacks: ['generic', 'nextjs', 'nestjs', 'python', 'dotnet'], profiles: ['web', 'mobile', 'ai', 'iot', 'legacy', 'desktop', 'enterprise', 'game', 'generic'], license: 'MIT' },
  { name: 'ponytail', source: 'https://github.com/DietrichGebert/ponytail.git', repo: 'DietrichGebert/ponytail', description: 'YAGNI simplicity ladder, stdlib-first minimal diffs without sacrificing safety', stacks: ['generic', 'nextjs', 'nestjs', 'python', 'dotnet'], profiles: ['web', 'mobile', 'ai', 'iot', 'legacy', 'desktop', 'enterprise', 'game', 'generic'], license: 'MIT' },
  { name: 'vercel-react-best-practices', source: 'vercel-labs/agent-skills@vercel-react-best-practices', repo: 'vercel-labs/agent-skills', description: 'React & Next.js bundle, rendering, and Server Component performance practices', stacks: ['nextjs', 'react'], profiles: ['web'], license: 'Apache-2.0' },
  { name: 'web-design-guidelines', source: 'vercel-labs/agent-skills@web-design-guidelines', repo: 'vercel-labs/agent-skills', description: 'Web UI, responsive ergonomics, and accessibility checklist', stacks: ['nextjs', 'react'], profiles: ['web'], license: 'Apache-2.0' },
  { name: 'frontend-design', source: 'anthropics/skills@frontend-design', repo: 'anthropics/skills', description: 'Intentional frontend design systems and responsive visual hierarchy', stacks: ['nextjs', 'react'], profiles: ['web'], license: 'Apache-2.0' },
  { name: 'webapp-testing', source: 'anthropics/skills@webapp-testing', repo: 'anthropics/skills', description: 'Playwright browser E2E testing patterns for web applications', stacks: ['nextjs', 'react'], profiles: ['web'], license: 'Apache-2.0' }
];

const SCRIPT_EXTS = new Set(['.sh', '.bash', '.ps1', '.psm1', '.cmd', '.bat', '.mjs', '.js', '.cjs', '.ts', '.py']);

const SKILL_SECURITY_RULES = [
  { id: 'remote-pipe-exec', severity: 'critical', re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba)?sh\b|powershell[^\n]*(?:iex|Invoke-Expression)|\bInvoke-Expression\b[^\n]*(?:Invoke-WebRequest|iwr|Net\.WebClient|DownloadString)/i, summary: 'Downloads and executes remote code without review' },
  { id: 'destructive-delete', severity: 'critical', re: /\brm\s+-rf\s+(?:\/|~|\$HOME|\*)|\bRemove-Item\b[^\n]*-Recurse[^\n]*(?:\$HOME|~|C:\\\\|\s+\/\s+)/i, summary: 'Destructive recursive deletion against root or home paths' },
  { id: 'ide-process-kill', severity: 'critical', re: /(?:taskkill|Stop-Process|pkill|killall)[^\n]*(?:antigravity|cursor)/i, summary: 'Attempts to terminate Antigravity or Cursor IDE processes' },
  { id: 'credential-exfiltration', severity: 'critical', re: /(?:\.ssh|\.aws|id_rsa|FACTORY_DB_PATH|\.env|token|secret)[\s\S]{0,160}(?:curl\s+-|Invoke-RestMethod|Invoke-WebRequest|fetch\s*\(|https?:\/\/)/i, summary: 'Reads sensitive credential paths alongside outbound HTTP transfer' },
  { id: 'prompt-injection-override', severity: 'high', re: /\b(?:ignore all previous instructions|bypass approval gate|disable secret scan|mark unverified tests as pass|silently push to main)\b/i, summary: 'Prompt-injection phrase attempting to override factory safety gates' },
  { id: 'global-package-install', severity: 'medium', re: /\b(?:npm\s+install\s+-g|pip\s+install\s+--user|winget\s+install|choco\s+install)\b/i, summary: 'References unreviewed global package installation command' },
  { id: 'network-command', severity: 'low', re: /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|fetch\s*\()\b/i, summary: 'Contains outbound network call reference' }
];

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_FILE)) return { allowlisted_skills: [], vetted_repositories: {} };
  return JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8'));
}

function listAllFilesSorted(rootDir, prefix = '', acc = []) {
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(rootDir, entry.name);
    if (entry.isDirectory()) listAllFilesSorted(full, rel, acc);
    else if (entry.isFile()) acc.push(rel);
  }
  return acc.sort();
}

/** Compute deterministic SHA-256 hash over every non-git file path and content inside a skill folder. */
export function computeDirectorySha256(dir) {
  const root = resolve(dir);
  const hash = createHash('sha256');
  const files = listAllFilesSorted(root);
  for (const rel of files) {
    hash.update(rel + '\n', 'utf8');
    hash.update(readFileSync(join(root, rel)));
  }
  return { sha256: hash.digest('hex'), files };
}

/** Inspect SKILL.md and all referenced scripts inside a skill directory before trusting or installing. */
export function inspectSkillSecurity(skillDir) {
  const root = resolve(skillDir);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new Error(`Skill directory not found: ${root}`);
  }
  const skillMd = join(root, 'SKILL.md');
  if (!existsSync(skillMd)) {
    return {
      safe: false,
      riskLevel: 'high',
      findings: [{ severity: 'high', category: 'missing-skill-md', file: 'SKILL.md', summary: 'Skill package is missing required SKILL.md' }],
      sha256: null,
      filesInspected: 0,
      scriptFiles: [],
      networkActions: [],
      shellActions: [],
      requiresApproval: true
    };
  }

  const { sha256, files } = computeDirectorySha256(root);
  const findings = [];
  const scriptFiles = [];
  const networkActions = [];
  const shellActions = [];

  for (const rel of files) {
    const ext = extname(rel).toLowerCase();
    const isScript = SCRIPT_EXTS.has(ext);
    if (isScript) scriptFiles.push(rel);
    if (!isScript && ext !== '.md' && ext !== '.json' && ext !== '.txt' && ext !== '.yaml' && ext !== '.yml') continue;

    const raw = readFileSync(join(root, rel), 'utf8');
    for (const rule of SKILL_SECURITY_RULES) {
      if (rule.re.test(raw)) {
        if (rule.id === 'network-command') {
          networkActions.push(`${rel}: ${rule.summary}`);
          continue;
        }
        if (isScript && rule.severity !== 'low') {
          shellActions.push(`${rel}: ${rule.id}`);
        }
        findings.push({ severity: rule.severity, category: rule.id, file: rel, summary: rule.summary });
      }
    }
  }

  const secScan = scanSecrets(root);
  for (const sf of secScan.findings) {
    findings.push({ severity: sf.severity, category: `secret:${sf.category}`, file: sf.file, summary: sf.summary });
  }

  const hasCritical = findings.some(f => f.severity === 'critical');
  const hasHigh = findings.some(f => f.severity === 'high');
  const riskLevel = hasCritical ? 'critical' : (hasHigh ? 'high' : (findings.length ? 'medium' : 'low'));

  return {
    safe: !hasCritical && !hasHigh,
    riskLevel,
    findings,
    sha256,
    filesInspected: files.length,
    scriptFiles,
    networkActions,
    shellActions,
    requiresApproval: riskLevel !== 'low'
  };
}

function scanInstalledSkillDirs(dirs) {
  const seen = new Map();
  for (const base of dirs) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = join(base, entry.name, 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      if (!seen.has(entry.name)) {
        const text = readFileSync(skillMd, 'utf8');
        const descMatch = text.match(/description:\s*>?\s*\n?\s*([^\n]+)/i);
        seen.set(entry.name, {
          name: entry.name,
          path: join(base, entry.name),
          source: 'local-installed',
          description: descMatch ? descMatch[1].replace(/^["']|["']$/g, '').trim() : entry.name
        });
      }
    }
  }
  return seen;
}

function parseNpxSkillsFind(stdout) {
  const results = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = line.match(/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.:-]+)/);
    if (m) {
      const spec = m[1];
      const [repo, name] = spec.split('@');
      results.push({ name, source: spec, repo, description: `Community/vendor skill from ${repo}`, from_npx_skills: true });
    }
  }
  return results;
}

/** Rank candidate skills by task relevance, IDE support, security posture, and duplicate avoidance. */
export function rankSkillCandidates(candidates, { query = '', adapters = [], profileId = null, installedSet = new Set(), limit = 10 } = {}) {
  const qTokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const allowlist = loadAllowlist();
  const allowedNames = new Set(allowlist.allowlisted_skills || []);
  const vettedRepos = new Set(Object.keys(allowlist.vetted_repositories || {}));

  const dedup = new Map();
  for (const c of candidates) {
    const hay = `${c.name} ${c.description || ''} ${(c.stacks || []).join(' ')} ${(c.profiles || []).join(' ')}`.toLowerCase();
    let score = 0;
    for (const t of qTokens) {
      if (c.name.toLowerCase().includes(t)) score += 25;
      else if (hay.includes(t)) score += 10;
    }
    for (const ad of adapters) {
      if ((c.stacks || []).includes(ad)) score += 15;
    }
    if (profileId && (c.profiles || []).includes(profileId)) score += 10;
    if (allowedNames.has(c.name) || vettedRepos.has(c.repo)) score += 12;
    if (installedSet.has(c.name)) score += 5;

    const existing = dedup.get(c.name);
    if (!existing || score > existing.score) {
      dedup.set(c.name, {
        ...c,
        score,
        already_installed: installedSet.has(c.name),
        allowlisted: allowedNames.has(c.name) || vettedRepos.has(c.repo),
        compatible_ides: ['antigravity', 'cursor']
      });
    }
  }

  return [...dedup.values()]
    .filter(item => qTokens.length === 0 || item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Search local installed skills, curated catalog, and optional online skills.sh / GitHub index. */
export function searchSkills(query = '', { projectPath = '.', offline = false, limit = 10, factoryRoot = DEFAULT_FACTORY_ROOT } = {}) {
  const root = resolve(projectPath);
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  const installed = scanInstalledSkillDirs([
    join(root, '.agents', 'skills'),
    join(root, '.cursor', 'skills'),
    join(home, '.gemini', 'config', 'skills'),
    join(home, '.cursor', 'skills')
  ]);

  const candidates = [
    ...installed.values(),
    ...CURATED_SKILL_CATALOG.map(c => ({ ...c, source_type: c.repo === 'Myfactory/bundled' ? 'bundled' : 'curated' }))
  ];

  // Add bundled skills from factoryRoot if not listed
  const bundledDir = join(factoryRoot, '.agents', 'skills');
  if (existsSync(bundledDir)) {
    for (const entry of scanInstalledSkillDirs([bundledDir]).values()) {
      if (!candidates.some(c => c.name === entry.name)) {
        candidates.push({ ...entry, source: 'local-bundled', repo: 'Myfactory/bundled', source_type: 'bundled' });
      }
    }
  }

  let onlineUsed = false;
  let onlineNote = offline ? 'Offline mode: searched local registry and vetted catalog only.' : 'npx skills unavailable or returned no results';
  if (!offline && query.trim()) {
    const res = safeSpawn('npx', ['--no-install', 'skills', 'find', query.trim()], { cwd: root, timeout: 10000 });
    if (res.ok && res.stdout) {
      onlineUsed = true;
      const parsed = parseNpxSkillsFind(res.stdout);
      onlineNote = `Queried npx skills CLI (${parsed.length} match(es))`;
      candidates.push(...parsed);
    }
  }

  const ranked = rankSkillCandidates(candidates, {
    query,
    installedSet: new Set(installed.keys()),
    limit
  });

  return { query, offline, online_used: onlineUsed, note: onlineNote, sources: KNOWN_SKILL_SOURCES, results: ranked };
}

/** Recommend ONLY the minimum useful skills matching the active project's detected stack & profile. */
export function recommendSkills(projectPath = '.', { offline = true } = {}) {
  const root = resolve(projectPath);
  const stack = inspectProjectStack(root, { includeRuntimes: false });
  const profile = detectProjectProfile(root, stack);
  const installed = scanInstalledSkillDirs([
    join(root, '.agents', 'skills'),
    join(root, '.cursor', 'skills')
  ]);

  // Strict domain filtering: never recommend Flutter/Unity/Electron to a pure Next.js app
  const matching = CURATED_SKILL_CATALOG.filter(c => {
    const stackOverlap = (c.stacks || []).some(s => stack.adapters.includes(s));
    const profileOverlap = (c.profiles || []).includes(profile.profileId);
    if (c.name === 'eng-games') return profile.profileId === 'game';
    if (c.name === 'eng-mobile') return profile.profileId === 'mobile' || stack.adapters.includes('flutter') || stack.adapters.includes('expo');
    if (c.name === 'eng-desktop') return profile.profileId === 'desktop' || stack.adapters.includes('desktop');
    if (c.name === 'eng-ai-biometrics') return profile.profileId === 'ai' || stack.adapters.includes('biometrics');
    return stackOverlap || profileOverlap || c.stacks.includes('generic');
  });

  const ranked = rankSkillCandidates(matching, {
    adapters: stack.adapters,
    profileId: profile.profileId,
    installedSet: new Set(installed.keys()),
    limit: 8
  });

  return {
    project: root,
    profile: profile.profileId,
    adapters: stack.adapters,
    offline,
    recommended: ranked
  };
}

function copyDirRecursive(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.isSymbolicLink()) continue;
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else if (entry.isFile()) copyFileSync(s, d);
  }
}

function lockfilePath(projectPath) {
  return join(resolve(projectPath), '.factory', 'skills-lock.json');
}

function readLockfile(projectPath) {
  const p = lockfilePath(projectPath);
  if (!existsSync(p)) return { schema: 1, skills: {} };
  return JSON.parse(readFileSync(p, 'utf8'));
}

function writeLockfile(projectPath, lock) {
  const p = lockfilePath(projectPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

/** Safely inspect, authorize, and install a skill without overwriting or executing untrusted install scripts. */
export function installSkill(spec, {
  projectPath = '.',
  global = false,
  approve = false,
  offline = false,
  overwrite = false,
  db = null,
  factoryRoot = DEFAULT_FACTORY_ROOT,
  globalHome = null
} = {}) {
  if (!spec || !String(spec).trim()) throw new Error('A skill name, local folder path, or owner/repo@skill spec is required');
  const root = resolve(projectPath);
  const rawSpec = String(spec).trim();
  const home = globalHome ? resolve(globalHome) : (process.env.USERPROFILE || process.env.HOME || homedir());

  const targetDirs = global
    ? [join(home, '.gemini', 'config', 'skills'), join(home, '.cursor', 'skills')]
    : [join(root, '.agents', 'skills'), join(root, '.cursor', 'skills')];

  let sourceType = 'external';
  let sourceUrl = rawSpec;
  let commitSha = null;
  let skillName = null;
  let stagedDir = null;
  let cleanupDir = null;

  try {
    if (existsSync(rawSpec) && lstatSync(rawSpec).isDirectory()) {
      stagedDir = resolve(rawSpec);
      skillName = stagedDir.split(/[\\/]/).pop();
      sourceType = 'local-path';
    } else if (existsSync(join(factoryRoot, '.agents', 'skills', rawSpec, 'SKILL.md'))) {
      stagedDir = join(factoryRoot, '.agents', 'skills', rawSpec);
      skillName = rawSpec;
      sourceType = 'bundled';
      sourceUrl = 'Myfactory/bundled';
    } else if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$/.test(rawSpec)) {
      if (offline) {
        throw new Error(`Offline mode: cannot fetch external skill "${rawSpec}" from GitHub.`);
      }
      const [repoSlug, reqSkill] = rawSpec.split('@');
      skillName = reqSkill;
      sourceType = 'github';
      sourceUrl = `https://github.com/${repoSlug}.git`;
      cleanupDir = mkdtempSync(join(tmpdir(), 'factory-skill-stage-'));
      execFileSync('git', ['clone', '--quiet', '--depth', '1', sourceUrl, cleanupDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      commitSha = execFileSync('git', ['-C', cleanupDir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

      const candidates = [
        join(cleanupDir, 'skills', reqSkill),
        join(cleanupDir, '.agents', 'skills', reqSkill),
        join(cleanupDir, reqSkill)
      ];
      stagedDir = candidates.find(d => existsSync(join(d, 'SKILL.md'))) || null;
      if (!stagedDir) {
        throw new Error(`Skill "${reqSkill}" not found inside repository ${repoSlug}`);
      }
    } else {
      throw new Error(`Skill not found locally or in supported formats (name, local path, or owner/repo@skill): ${rawSpec}`);
    }

    // Security inspection FIRST
    const inspection = inspectSkillSecurity(stagedDir);
    if (!inspection.safe) {
      throw new Error(`Blocked unsafe skill "${skillName}" (${inspection.riskLevel}): ${inspection.findings.map(f => `${f.category}@${f.file}`).join(', ')}`);
    }

    // Allowlist & approval gate for external/unknown skills
    const allowlist = loadAllowlist();
    const isAllowlisted = sourceType === 'bundled' || (allowlist.allowlisted_skills || []).includes(skillName);
    if (!isAllowlisted && !approve) {
      throw new Error(`Explicit --approve is required before installing external skill "${skillName}" (sha256=${inspection.sha256.slice(0, 12)})`);
    }

    // Prevent duplicate installation
    const existingTargets = targetDirs.filter(d => existsSync(join(d, skillName, 'SKILL.md')));
    if (existingTargets.length > 0 && !overwrite) {
      throw new Error(`Skill "${skillName}" is already installed at ${join(existingTargets[0], skillName)}`);
    }

    // Stage atomically and never write to ~/.cursor/skills-cursor
    const installedPaths = [];
    for (const dir of targetDirs) {
      if (dir.toLowerCase().includes('skills-cursor')) continue;
      const dest = join(dir, skillName);
      copyDirRecursive(stagedDir, dest);
      installedPaths.push(dest);
    }

    const catalogEntry = CURATED_SKILL_CATALOG.find(c => c.name === skillName);
    const lock = readLockfile(root);
    lock.skills[skillName] = {
      name: skillName,
      source: sourceUrl,
      source_type: sourceType,
      commit_sha: commitSha,
      sha256: inspection.sha256,
      license: catalogEntry?.license || 'UNKNOWN',
      approval_status: isAllowlisted ? 'allowlisted' : 'approved',
      installed_paths: installedPaths,
      verified_at: new Date().toISOString()
    };
    writeLockfile(root, lock);

    if (db) {
      db.upsertSkillRecord({
        name: skillName,
        source: sourceUrl,
        source_type: sourceType,
        version_ref: commitSha || 'local',
        commit_sha: commitSha,
        sha256: inspection.sha256,
        license: catalogEntry?.license || 'UNKNOWN',
        compatible_ides: ['antigravity', 'cursor'],
        required_tools: [],
        install_status: 'installed',
        approval_status: isAllowlisted ? 'allowlisted' : 'approved',
        dependencies: [],
        security_summary: `safe (files=${inspection.filesInspected}, risk=${inspection.riskLevel})`,
        installed_paths: installedPaths,
        last_verified_at: new Date().toISOString()
      });
    }

    return {
      ok: true,
      name: skillName,
      source: sourceUrl,
      sha256: inspection.sha256,
      approval_status: isAllowlisted ? 'allowlisted' : 'approved',
      installed_paths: installedPaths
    };
  } finally {
    if (cleanupDir) rmSync(cleanupDir, { recursive: true, force: true });
  }
}

export function listSkills({ projectPath = '.', db = null } = {}) {
  const root = resolve(projectPath);
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  const projectInstalled = scanInstalledSkillDirs([join(root, '.agents', 'skills'), join(root, '.cursor', 'skills')]);
  const globalInstalled = scanInstalledSkillDirs([join(home, '.gemini', 'config', 'skills'), join(home, '.cursor', 'skills')]);
  const lock = readLockfile(root);
  const registry = db ? db.listSkillRecords() : [];
  return {
    project: root,
    project_skills: [...projectInstalled.values()],
    global_skills_count: globalInstalled.size,
    lockfile_skills: Object.values(lock.skills || {}),
    registry_records: registry
  };
}

/** Verify installed lockfile hashes match files on disk without tampering. */
export function checkSkills({ projectPath = '.' } = {}) {
  const root = resolve(projectPath);
  const lock = readLockfile(root);
  const results = [];
  for (const [name, entry] of Object.entries(lock.skills || {})) {
    const firstPath = (entry.installed_paths || [])[0] || join(root, '.agents', 'skills', name);
    if (!existsSync(firstPath)) {
      results.push({ name, ok: false, status: 'MISSING', detail: `Missing path ${firstPath}` });
      continue;
    }
    const sec = inspectSkillSecurity(firstPath);
    const hashOk = !entry.sha256 || sec.sha256 === entry.sha256;
    results.push({
      name,
      ok: sec.safe && hashOk,
      status: !sec.safe ? 'UNSAFE' : (hashOk ? 'VERIFIED' : 'MODIFIED_HASH'),
      sha256: sec.sha256,
      expected_sha256: entry.sha256
    });
  }
  return { ok: results.every(r => r.ok), checked: results.length, results };
}

export function removeSkill(name, { projectPath = '.', db = null } = {}) {
  const root = resolve(projectPath);
  const removed = [];
  for (const base of [join(root, '.agents', 'skills', name), join(root, '.cursor', 'skills', name)]) {
    if (existsSync(base)) {
      rmSync(base, { recursive: true, force: true });
      removed.push(base);
    }
  }
  const lock = readLockfile(root);
  if (lock.skills && lock.skills[name]) {
    delete lock.skills[name];
    writeLockfile(root, lock);
  }
  if (db) db.deleteSkillRecord(name);
  return { removed_name: name, removed_paths: removed };
}

export function updateSkills({ projectPath = '.', offline = false, factoryRoot = DEFAULT_FACTORY_ROOT, db = null } = {}) {
  const root = resolve(projectPath);
  const lock = readLockfile(root);
  const updated = [];
  const skipped = [];
  for (const entry of Object.values(lock.skills || {})) {
    if (entry.source_type === 'bundled') {
      const res = installSkill(entry.name, { projectPath: root, overwrite: true, approve: true, offline: true, factoryRoot, db });
      updated.push({ name: entry.name, sha256: res.sha256 });
    } else if (offline) {
      skipped.push({ name: entry.name, reason: 'Offline mode skips remote external skill updates' });
    } else if (/github\.com\/([^/]+\/[^/.]+)\.git/.test(entry.source || '')) {
      const m = entry.source.match(/github\.com\/([^/]+\/[^/.]+)\.git/);
      const res = installSkill(`${m[1]}@${entry.name}`, { projectPath: root, overwrite: true, approve: true, offline: false, db });
      updated.push({ name: entry.name, sha256: res.sha256 });
    } else {
      skipped.push({ name: entry.name, reason: 'Local path skill managed manually' });
    }
  }
  return { updated, skipped };
}
