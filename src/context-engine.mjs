import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectProjectStack } from './adapters.mjs';
import { SPECIALIST_BY_ID, resolveSpecialist } from './agent-registry.mjs';
import { defaultGlobalHome } from './db.mjs';
import { retrieveRelevantMemories } from './memory.mjs';
import { detectProjectProfile } from './profiles.mjs';
import { selectSpecialists } from './router.mjs';

const DEFAULT_FACTORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const CONTEXT_BUDGETS = {
  FAST: 8000,
  STANDARD: 20000,
  DEEP: 42000,
  RELEASE: 50000
};

const MINIMAL_POLICY_DIGEST = [
  '1. Inspect code/config/tests before editing; preserve existing files & schemas.',
  '2. Work only inside approved project/worktree boundaries; never touch secrets.',
  '3. Verify with real commands (`factory verify`); mark unrun checks NOT VERIFIED.',
  '4. Never close IDEs, auto-push, or auto-deploy without explicit human approval.'
].join('\n');

function safeGitHead(projectPath) {
  if (!existsSync(join(projectPath, '.git'))) return 'no-git';
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim() || 'no-head';
  } catch {
    return 'no-head';
  }
}

function safeConfigHash(projectPath) {
  const cfgPath = join(projectPath, '.factory', 'config.json');
  if (!existsSync(cfgPath)) return 'no-config';
  return createHash('sha256').update(readFileSync(cfgPath)).digest('hex');
}

/** Read cached stack/profile summary, invalidating automatically on Git HEAD or config changes. */
export function getCachedProjectSummary(projectPath, { bypassCache = false } = {}) {
  const root = resolve(projectPath);
  const cacheFile = join(root, '.factory', 'cache', 'context-cache.json');
  const gitHead = safeGitHead(root);
  const configHash = safeConfigHash(root);

  if (!bypassCache && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (cached.gitHead === gitHead && cached.configHash === configHash && cached.summary) {
        return { cached: true, gitHead, configHash, ...cached.summary };
      }
    } catch {
      // Rebuild stale or corrupt cache.
    }
  }

  const stack = inspectProjectStack(root, { includeRuntimes: false });
  const detected = detectProjectProfile(root, stack);
  const summary = {
    adapters: stack.adapters,
    required_checks: stack.required_checks,
    profile_id: detected.profileId,
    profile_label: detected.profile.label
  };

  if (existsSync(join(root, '.factory'))) {
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ gitHead, configHash, updated_at: new Date().toISOString(), summary }, null, 2) + '\n', 'utf8');
  }

  return { cached: false, gitHead, configHash, ...summary };
}

function sumDirectoryMarkdownBytes(dir) {
  if (!existsSync(dir)) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(md|mdc)$/i.test(entry.name)) {
        bytes += statSync(full).size;
        files += 1;
      }
    }
  }
  walk(dir);
  return { bytes, files };
}

/** Measure exact naive baseline byte footprint (loading all agents + all skills + all references + all rules). */
export function measureNaiveBaseline({ projectPath = '.', factoryRoot = DEFAULT_FACTORY_ROOT } = {}) {
  const root = resolve(factoryRoot);
  const proj = resolve(projectPath);

  const scanDirs = [
    join(existsSync(join(proj, '.agent', 'agents')) ? proj : root, '.agent', 'agents'),
    join(existsSync(join(proj, '.agents', 'skills')) ? proj : root, '.agents', 'skills'),
    join(existsSync(join(proj, '.agents', 'rules')) ? proj : root, '.agents', 'rules')
  ];

  let totalBytes = 0;
  let totalFiles = 0;
  for (const d of scanDirs) {
    const s = sumDirectoryMarkdownBytes(d);
    totalBytes += s.bytes;
    totalFiles += s.files;
  }

  const globalMemDir = join(defaultGlobalHome(), 'memory');
  if (existsSync(globalMemDir)) {
    const gm = sumDirectoryMarkdownBytes(globalMemDir);
    totalBytes += gm.bytes;
    totalFiles += gm.files;
  }

  return { baseline_bytes: totalBytes, baseline_files: totalFiles };
}

function readAgentSnippet(agentId, projectPath, factoryRoot, maxBytes = 1600) {
  const candidates = [
    join(projectPath, '.agents', 'agents', agentId, 'agent.md'),
    join(factoryRoot, '.agents', 'agents', agentId, 'agent.md')
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf8');
      return { path: file, content: raw.slice(0, maxBytes) };
    }
  }
  const spec = SPECIALIST_BY_ID.get(agentId) || resolveSpecialist(agentId);
  return {
    path: `registry:${agentId}`,
    content: spec ? `${spec.name}: ${spec.responsibility}` : agentId
  };
}

function readSkillHeaderAndBody(skillName, projectPath, factoryRoot, maxBytes = 2400) {
  const roots = [
    join(projectPath, '.agents', 'skills', skillName),
    join(factoryRoot, '.agents', 'skills', skillName),
    join(defaultGlobalHome(), '..', 'config', 'skills', skillName)
  ];
  for (const dir of roots) {
    const skillMd = join(dir, 'SKILL.md');
    if (existsSync(skillMd)) {
      const content = readFileSync(skillMd, 'utf8').slice(0, maxBytes);
      const refsDir = join(dir, 'references');
      const refFiles = existsSync(refsDir)
        ? readdirSync(refsDir).filter(f => f.endsWith('.md')).map(f => join(refsDir, f))
        : [];
      return { name: skillName, path: skillMd, content, refFiles };
    }
  }
  return null;
}

/** Build progressive, budget-bounded context following the 10-step loading sequence. */
export function buildTaskContext({
  projectPath = '.',
  projectDb = null,
  globalDb = null,
  request = '',
  files = [],
  taskId = null,
  loadReferences = false,
  factoryRoot = DEFAULT_FACTORY_ROOT,
  providerTelemetry = null,
  bypassCache = false
} = {}) {
  const startMs = Date.now();
  const root = resolve(projectPath);
  const summary = getCachedProjectSummary(root, { bypassCache });

  const projRec = projectDb ? projectDb.getProject(root) : null;
  const activeProfile = (projRec && projectDb?.getProjectProfile(projRec.id)?.profile_id) || summary.profile_id || 'generic';

  const memResult = (projectDb || globalDb)
    ? retrieveRelevantMemories({
        projectDb,
        globalDb,
        projectId: projRec?.id || null,
        profileId: activeProfile,
        stack: summary.adapters,
        query: request,
        limit: 8
      })
    : { items: [], overridden: [], counts: { project_returned: 0, global_returned: 0, overridden_count: 0 } };

  const selection = selectSpecialists({
    request,
    profileId: activeProfile,
    stack: { adapters: summary.adapters },
    files,
    memories: memResult.items
  });

  const budgetBytes = CONTEXT_BUDGETS[selection.complexity] || CONTEXT_BUDGETS.STANDARD;
  const agentIds = [selection.primary_agent, ...selection.supporting_agents];
  const loadedAgents = agentIds.map(id => readAgentSnippet(id, root, factoryRoot));

  const loadedSkills = [];
  const deferredReferences = [];
  for (const sk of selection.selected_skills) {
    const info = readSkillHeaderAndBody(sk, root, factoryRoot);
    if (info) {
      loadedSkills.push({ name: info.name, path: info.path, content: info.content });
      for (const rf of info.refFiles) deferredReferences.push(rf);
    }
  }

  const shouldLoadRefs = Boolean(loadReferences || selection.complexity === 'DEEP' || selection.complexity === 'RELEASE');
  const loadedReferences = [];

  const bundle = {
    policy_digest: MINIMAL_POLICY_DIGEST,
    task_request: request,
    task_id: taskId,
    project: { path: root, profile: activeProfile, adapters: summary.adapters, cached: summary.cached },
    memories: memResult.items.map(m => ({ id: m.id, origin: m.origin, category: m.category, statement: m.statement, source_type: m.source_type })),
    agents: loadedAgents,
    skills: loadedSkills,
    deferred_references: deferredReferences,
    loaded_references: loadedReferences
  };

  let currentBytes = Buffer.byteLength(JSON.stringify(bundle), 'utf8');
  if (shouldLoadRefs) {
    for (const refPath of deferredReferences) {
      if (currentBytes >= budgetBytes) break;
      const raw = readFileSync(refPath, 'utf8');
      const remaining = Math.max(0, budgetBytes - currentBytes - 200);
      if (remaining < 256) break;
      const slice = raw.slice(0, remaining);
      loadedReferences.push({ path: refPath, content: slice });
      currentBytes = Buffer.byteLength(JSON.stringify(bundle), 'utf8');
    }
  }

  const baseline = measureNaiveBaseline({ projectPath: root, factoryRoot });
  const durationMs = Date.now() - startMs;

  if (projectDb && projRec) {
    projectDb.recordRoutingDecision({
      project_id: projRec.id,
      task_id: taskId,
      request_summary: request.slice(0, 240),
      profile_id: activeProfile,
      complexity: selection.complexity,
      primary_agent: selection.primary_agent,
      supporting_agents: selection.supporting_agents,
      selected_skills: selection.selected_skills,
      references: loadedReferences.map(r => r.path),
      estimated_budget_chars: currentBytes
    });

    projectDb.recordContextMetric({
      project_id: projRec.id,
      task_id: taskId,
      mode: selection.complexity,
      input_tokens: providerTelemetry?.input_tokens ?? null,
      output_tokens: providerTelemetry?.output_tokens ?? null,
      estimated_context_bytes: currentBytes,
      baseline_context_bytes: baseline.baseline_bytes,
      duration_ms: durationMs,
      agent_invocations: agentIds.length,
      cost_usd: providerTelemetry?.cost_usd ?? null
    });
  }

  return {
    mode: selection.complexity,
    budget_bytes: budgetBytes,
    within_budget: currentBytes <= budgetBytes || selection.complexity === 'RELEASE',
    estimated_context_bytes: currentBytes,
    baseline_context_bytes: baseline.baseline_bytes,
    baseline_files: baseline.baseline_files,
    loaded_agent_count: loadedAgents.length,
    loaded_skill_count: loadedSkills.length,
    loaded_reference_count: loadedReferences.length,
    deferred_reference_count: deferredReferences.length,
    byte_reduction_ratio: baseline.baseline_bytes > 0
      ? Number((((baseline.baseline_bytes - currentBytes) / baseline.baseline_bytes) * 100).toFixed(2))
      : 0,
    token_telemetry: providerTelemetry
      ? { input_tokens: providerTelemetry.input_tokens ?? null, output_tokens: providerTelemetry.output_tokens ?? null, cost_usd: providerTelemetry.cost_usd ?? null }
      : { available: false, reason: 'No live LLM provider token telemetry attached in local deterministic mode' },
    cached_stack: summary.cached,
    selection,
    bundle
  };
}

/** Benchmark real measured progressive vs naive full-load bytes and warm vs cold cache timing. */
export function runContextBenchmark({ projectPath = '.', projectDb = null, globalDb = null, factoryRoot = DEFAULT_FACTORY_ROOT } = {}) {
  const root = resolve(projectPath);
  const prompts = [
    { label: 'FAST typo tweak', request: 'Fix typo in button label' },
    { label: 'STANDARD backend bug', request: 'Fix NestJS authentication token guard bug and add test' },
    { label: 'DEEP biometric GPS mobile', request: 'Build biometric face liveness attendance check-in with GPS geofencing in React Native mobile app' },
    { label: 'RELEASE verification', request: 'Prepare production release candidate and verify security gates' }
  ];

  const t0 = Date.now();
  getCachedProjectSummary(root, { bypassCache: true });
  const coldMs = Date.now() - t0;

  const t1 = Date.now();
  const warmSummary = getCachedProjectSummary(root, { bypassCache: false });
  const warmMs = Date.now() - t1;

  const cases = prompts.map(p => {
    const res = buildTaskContext({ projectPath: root, projectDb, globalDb, request: p.request, factoryRoot });
    return {
      label: p.label,
      mode: res.mode,
      loaded_agents: res.loaded_agent_count,
      loaded_skills: res.loaded_skill_count,
      loaded_references: res.loaded_reference_count,
      deferred_references: res.deferred_reference_count,
      estimated_context_bytes: res.estimated_context_bytes,
      baseline_context_bytes: res.baseline_context_bytes,
      byte_reduction_ratio: res.byte_reduction_ratio
    };
  });

  const baseline = measureNaiveBaseline({ projectPath: root, factoryRoot });
  return {
    project: root,
    baseline_bytes: baseline.baseline_bytes,
    baseline_files: baseline.baseline_files,
    token_telemetry_status: 'unavailable (local measurement records bytes & latency only; real LLM token counts unavailable offline)',
    cache_timing: { cold_ms: coldMs, warm_ms: warmMs, cache_hit: warmSummary.cached },
    cases
  };
}
