import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const readJson = (file, fallback = null) => {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
};

function commandExists(cmd) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'which';
  const r = spawnSync(probe, [cmd], { encoding: 'utf8', stdio: 'ignore' });
  return r.status === 0;
}

let cachedRuntimes = null;
let cachedAt = 0;

export function detectRuntimes(forceRefresh = false) {
  if (!forceRefresh && cachedRuntimes && Date.now() - cachedAt < 60000) {
    return cachedRuntimes;
  }
  cachedRuntimes = {
    node: commandExists('node'),
    npm: commandExists('npm'),
    python: commandExists('python') || commandExists('py'),
    dotnet: commandExists('dotnet'),
    flutter: commandExists('flutter'),
    docker: commandExists('docker'),
    git: commandExists('git'),
    gh: commandExists('gh'),
    psql: commandExists('psql'),
    sqlcmd: commandExists('sqlcmd')
  };
  cachedAt = Date.now();
  return cachedRuntimes;
}

function collectNodeChecks(dir, prefix = '', cwd = undefined) {
  const pkg = readJson(join(dir, 'package.json'));
  if (!pkg) return [];
  const scripts = pkg.scripts || {};
  const checks = [];
  for (const script of ['lint', 'typecheck', 'test', 'build']) {
    const val = scripts[script];
    if (typeof val === 'string' && val.trim() && !val.includes('not specified')) {
      const check = { name: prefix ? `${prefix}-${script}` : script, command: 'npm', args: ['run', script] };
      if (cwd) check.cwd = cwd;
      checks.push(check);
    }
  }
  return checks;
}

function hasAnyFile(dir, matcher) {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some(name => matcher(name));
  } catch {
    return false;
  }
}

export const BUILTIN_ADAPTERS = [
  {
    id: 'nextjs',
    label: 'Next.js Web App',
    detect(dir) {
      const pkg = readJson(join(dir, 'package.json'));
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
      return Boolean(deps?.next || existsSync(join(dir, 'next.config.js')) || existsSync(join(dir, 'next.config.mjs')) || existsSync(join(dir, 'next.config.ts')));
    },
    checks: (dir, cwd) => collectNodeChecks(dir, cwd ? cwd.replace(/[\\/]/g, '-') : '', cwd)
  },
  {
    id: 'nestjs',
    label: 'NestJS Backend API',
    detect(dir) {
      const pkg = readJson(join(dir, 'package.json'));
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
      return Boolean(deps?.['@nestjs/core'] || existsSync(join(dir, 'nest-cli.json')));
    },
    checks: (dir, cwd) => collectNodeChecks(dir, cwd ? cwd.replace(/[\\/]/g, '-') : '', cwd)
  },
  {
    id: 'expo',
    label: 'Expo / React Native Mobile',
    detect(dir) {
      const pkg = readJson(join(dir, 'package.json'));
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
      return Boolean(deps?.expo || deps?.['react-native'] || existsSync(join(dir, 'app.json')) && deps?.react);
    },
    checks: (dir, cwd) => collectNodeChecks(dir, cwd ? cwd.replace(/[\\/]/g, '-') : 'mobile', cwd)
  },
  {
    id: 'react',
    label: 'React Web App',
    detect(dir) {
      const pkg = readJson(join(dir, 'package.json'));
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
      return Boolean(deps?.react && !deps?.next && !deps?.expo && !deps?.['react-native']);
    },
    checks: (dir, cwd) => collectNodeChecks(dir, cwd ? cwd.replace(/[\\/]/g, '-') : '', cwd)
  },
  {
    id: 'desktop',
    label: 'Desktop Application',
    detect(dir) {
      const pkg = readJson(join(dir, 'package.json'));
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
      return Boolean(deps?.electron || existsSync(join(dir, 'src-tauri', 'Cargo.toml')));
    },
    checks: (dir, cwd) => collectNodeChecks(dir, cwd ? cwd.replace(/[\\/]/g, '-') : 'desktop', cwd)
  },
  {
    id: 'node',
    label: 'Node.js Service / CLI',
    detect(dir) {
      return existsSync(join(dir, 'package.json'));
    },
    checks: (dir, cwd) => collectNodeChecks(dir, cwd ? cwd.replace(/[\\/]/g, '-') : '', cwd)
  },
  {
    id: 'python',
    label: 'Python Service / API',
    detect(dir) {
      return existsSync(join(dir, 'pyproject.toml')) || existsSync(join(dir, 'requirements.txt')) || existsSync(join(dir, 'manage.py'));
    },
    checks(dir, cwd) {
      const name = cwd ? `${cwd.replace(/[\\/]/g, '-')}-python-tests` : 'python-tests';
      const check = { name, command: 'python', args: ['-m', 'pytest', '-q'] };
      if (cwd) check.cwd = cwd;
      return [check];
    }
  },
  {
    id: 'ai_ml',
    label: 'AI / ML Pipeline',
    detect(dir) {
      const req = existsSync(join(dir, 'requirements.txt')) ? readFileSync(join(dir, 'requirements.txt'), 'utf8') : '';
      const py = existsSync(join(dir, 'pyproject.toml')) ? readFileSync(join(dir, 'pyproject.toml'), 'utf8') : '';
      const pkg = readJson(join(dir, 'package.json'));
      const deps = JSON.stringify({ ...pkg?.dependencies, ...pkg?.devDependencies });
      return /torch|transformers|langchain|scikit-learn|openai|google-genai|@google\/genai/i.test(req + py + deps);
    },
    checks: () => []
  },
  {
    id: 'dotnet',
    label: '.NET / ASP.NET Core',
    detect(dir) {
      return hasAnyFile(dir, f => /\.(sln|csproj|fsproj|sqlproj)$/i.test(f));
    },
    checks(dir, cwd) {
      const p = cwd ? `${cwd.replace(/[\\/]/g, '-')}-` : '';
      const build = { name: `${p}dotnet-build`, command: 'dotnet', args: ['build', '--no-restore'] };
      const test = { name: `${p}dotnet-test`, command: 'dotnet', args: ['test', '--no-build'] };
      if (cwd) { build.cwd = cwd; test.cwd = cwd; }
      return [build, test];
    }
  },
  {
    id: 'flutter',
    label: 'Flutter Mobile / Cross-Platform',
    detect(dir) {
      return existsSync(join(dir, 'pubspec.yaml'));
    },
    checks(dir, cwd) {
      const p = cwd ? `${cwd.replace(/[\\/]/g, '-')}-` : '';
      const analyze = { name: `${p}flutter-analyze`, command: 'flutter', args: ['analyze'] };
      const test = { name: `${p}flutter-test`, command: 'flutter', args: ['test'] };
      if (cwd) { analyze.cwd = cwd; test.cwd = cwd; }
      return [analyze, test];
    }
  },
  {
    id: 'postgres',
    label: 'PostgreSQL Schema / Migrations',
    detect(dir) {
      return existsSync(join(dir, 'prisma', 'schema.prisma')) || existsSync(join(dir, 'drizzle.config.ts')) || existsSync(join(dir, 'migrations')) || hasAnyFile(dir, f => /postgres.*\.sql$/i.test(f));
    },
    checks: () => []
  },
  {
    id: 'sqlserver',
    label: 'SQL Server Schema / Migrations',
    detect(dir) {
      return hasAnyFile(dir, f => /\.sqlproj$/i.test(f)) || existsSync(join(dir, 'sqlserver'));
    },
    checks: () => []
  },
  {
    id: 'docker',
    label: 'Docker Containerization',
    detect(dir) {
      return existsSync(join(dir, 'Dockerfile')) || existsSync(join(dir, 'docker-compose.yml')) || existsSync(join(dir, 'compose.yaml'));
    },
    checks: () => []
  }
];

const MONOREPO_SUBDIRS = ['frontend', 'backend', 'api', 'web', 'mobile', 'server', 'client'];

/** Detect project adapters and build deduplicated non-fabricated check commands. */
export function inspectProjectStack(projectPath, { includeRuntimes = true } = {}) {
  const root = resolve(projectPath);
  const runtimes = includeRuntimes ? detectRuntimes() : null;
  const detectedAdapters = new Set();
  const checks = [];
  const seenCheckKey = new Set();

  function scanDir(dir, cwd = undefined) {
    for (const adapter of BUILTIN_ADAPTERS) {
      if (adapter.detect(dir)) {
        detectedAdapters.add(adapter.id);
        for (const chk of adapter.checks(dir, cwd)) {
          const key = `${chk.cwd || '.'}::${chk.name}`;
          if (!seenCheckKey.has(key)) {
            seenCheckKey.add(key);
            checks.push(chk);
          }
        }
      }
    }
  }

  scanDir(root);
  let isMonorepo = false;
  for (const sub of MONOREPO_SUBDIRS) {
    const subPath = join(root, sub);
    if (existsSync(subPath)) {
      isMonorepo = true;
      scanDir(subPath, sub);
    }
  }
  for (const parent of ['apps', 'services', 'packages']) {
    const parentDir = join(root, parent);
    if (existsSync(parentDir)) {
      try {
        for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            isMonorepo = true;
            scanDir(join(parentDir, entry.name), `${parent}/${entry.name}`);
          }
        }
      } catch {
        // Ignore unreadable subfolder.
      }
    }
  }
  if (isMonorepo) detectedAdapters.add('monorepo');

  return {
    adapters: [...detectedAdapters],
    runtimes,
    required_checks: checks
  };
}
