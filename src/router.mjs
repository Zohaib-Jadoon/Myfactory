import { SPECIALIST_AGENTS, resolveSpecialist } from './agent-registry.mjs';

export const COMPLEXITY_MODES = {
  FAST: { id: 'FAST', maxAgents: 1, maxSkills: 2, pstackMode: 'lite', ponytailMode: 'lite', loadReferences: false },
  STANDARD: { id: 'STANDARD', maxAgents: 3, maxSkills: 4, pstackMode: 'standard', ponytailMode: 'full', loadReferences: false },
  DEEP: { id: 'DEEP', maxAgents: 5, maxSkills: 6, pstackMode: 'full', ponytailMode: 'full', loadReferences: true },
  RELEASE: { id: 'RELEASE', maxAgents: 5, maxSkills: 6, pstackMode: 'full', ponytailMode: 'full', loadReferences: true }
};

/** Classify task complexity without inflating simple tasks into multi-agent fan-out. */
export function classifyComplexity(request = '', { risk = null, stage = null } = {}) {
  const req = String(request || '').trim();
  if (risk === 'release' || stage === 'release_candidate' || /\b(release candidate|cut rc|production release|deploy to prod|publish app)\b/i.test(req)) {
    return COMPLEXITY_MODES.RELEASE;
  }
  if (
    risk === 'high' ||
    /\b(architect|architecture|migration|schema change|security audit|biometric|multi-tenant|liveness|anti-spoof|telematics|modernize|monorepo|end-to-end|gps.+react native)\b/i.test(req)
  ) {
    return COMPLEXITY_MODES.DEEP;
  }
  const hasComplexSignal = /\b(api|database|migration|mobile|build|test suite|deploy|feature|nestjs|nextjs|biometric|gps|refactor)\b/i.test(req);
  if (
    risk === 'low' ||
    (!hasComplexSignal && (req.length < 75 || /\b(typo|rename|copy change|spacing|readme|explain|status|single line|one line|small edit|css tweak|color tweak)\b/i.test(req)))
  ) {
    return COMPLEXITY_MODES.FAST;
  }
  return COMPLEXITY_MODES.STANDARD;
}

function isSpecialistAllowed(agent, { reqLower, adapters, profileId, filesText }) {
  const corpus = `${reqLower} ${filesText} ${adapters.join(' ')}`;

  if (agent.category === 'game-development') {
    return profileId === 'game' || /\b(unity|unreal|godot|game|gameplay|shader|netcode|multiplayer|frame budget|\.unity|\.uproject|\.godot|gdscript)\b/i.test(corpus);
  }
  if (['windows-iis-engineer', 'legacy-asp-modernizer', 'sql-server-specialist'].includes(agent.id)) {
    return profileId === 'legacy' || /\b(iis|classic asp|web\.config|tsql|t-sql|sql server|mssql|vbscript|\.asp|windows service|iis_asp|sqlserver)\b/i.test(corpus);
  }
  if (agent.id === 'biometric-ai-engineer') {
    return profileId === 'ai' || /\b(biometric|face recognition|face verification|liveness|anti-spoof|fingerprint|enrollment|far\/frr)\b/i.test(corpus);
  }
  if (['geospatial-engineer', 'iot-telematics-engineer'].includes(agent.id)) {
    return profileId === 'iot' || /\b(gps|geofence|geofencing|telemetry|telematics|fleet|mqtt|tracker|nmea|openstreetmap|leaflet|iot)\b/i.test(corpus);
  }
  if (['mobile-app-builder', 'flutter-engineer', 'react-native-engineer', 'mobile-device-tester'].includes(agent.id)) {
    return profileId === 'mobile' || /\b(mobile|android|ios|apk|expo|flutter|react native|react-native|device test)\b/i.test(corpus);
  }
  if (['desktop-app-builder', 'electron-engineer'].includes(agent.id)) {
    return profileId === 'desktop' || /\b(desktop|electron|tauri|nsis|msi|contextisolation|ipc)\b/i.test(corpus);
  }
  return true;
}

function scoreSpecialist(agent, { reqLower, adapters, profileId, filesText, memories }) {
  if (!isSpecialistAllowed(agent, { reqLower, adapters, profileId, filesText })) {
    return { score: -100, reasons: ['excluded-by-domain-boundary'] };
  }

  let score = 0;
  const reasons = [];

  for (const kw of agent.keywords || []) {
    const k = kw.toLowerCase();
    if (reqLower.includes(k)) {
      score += k.includes(' ') ? 20 : 14;
      reasons.push(`keyword:${kw}`);
    } else if (filesText.includes(k)) {
      score += 8;
      reasons.push(`file:${kw}`);
    }
  }

  for (const st of agent.supportedStacks || []) {
    const s = st.toLowerCase();
    for (const ad of adapters) {
      if (s.includes(ad.toLowerCase())) {
        score += 10;
        reasons.push(`stack:${ad}`);
      }
    }
  }

  if (profileId && (agent.profiles || []).includes(profileId)) {
    score += 6;
    reasons.push(`profile:${profileId}`);
  }

  for (const mem of memories || []) {
    const cat = String(mem.category || '').toLowerCase();
    if (cat && (agent.category.includes(cat) || agent.id.includes(cat))) {
      score += 3;
      reasons.push(`memory:${cat}`);
    }
  }

  // Targeted boosts for precision scenarios:
  if (/\b(bug|fix|regression|failing|broken|crash|error)\b/.test(reqLower)) {
    if (agent.id === 'regression-debugger') {
      score += 22;
      reasons.push('intent:bugfix');
    }
    if (['security-reviewer', 'release-verifier', 'api-tester'].includes(agent.id) && !/\b(security|release|test)\b/.test(reqLower)) {
      score -= 4;
    }
  }
  if (/\b(nestjs|backend|api|endpoint|server|controller|auth|authentication)\b/.test(reqLower) && agent.id === 'backend-architect') {
    score += 22;
    reasons.push('intent:backend-auth');
  }
  if (/\b(biometric|face|liveness|fingerprint)\b/.test(reqLower) && agent.id === 'biometric-ai-engineer') {
    score += 24;
    reasons.push('intent:biometric');
  }
  if (/\b(gps|geofence|location)\b/.test(reqLower) && agent.id === 'geospatial-engineer') {
    score += 22;
    reasons.push('intent:geospatial');
  }
  if (/\b(react native|react-native|expo|mobile|android|apk)\b/.test(reqLower) && agent.id === 'mobile-app-builder') {
    score += 22;
    reasons.push('intent:mobile');
  }
  if (/\b(react native|react-native)\b/.test(reqLower) && agent.id === 'react-native-engineer') {
    score += 18;
    reasons.push('intent:react-native');
  }
  if (/\b(unity)\b/.test(reqLower) && agent.id === 'unity-developer') {
    score += 26;
    reasons.push('intent:unity');
  }

  // Keep management/doc overhead low unless specifically requested
  if (['product', 'project-management', 'studio-operations'].includes(agent.category) && score > 0 && score < 18) {
    score -= 5;
  }

  return { score, reasons: [...new Set(reasons)] };
}

/** Select the minimal effective set of specialist agents, skills, and execution mode. */
export function selectSpecialists({
  request = '',
  profileId = 'generic',
  stack = { adapters: [] },
  files = [],
  taskState = null,
  memories = [],
  risk = null
} = {}) {
  const reqLower = String(request || '').toLowerCase();
  const adapters = stack?.adapters || [];
  const filesText = (files || []).join(' ').toLowerCase();
  const complexity = classifyComplexity(request, { taskState, risk });

  const scored = SPECIALIST_AGENTS.map(agent => {
    const res = scoreSpecialist(agent, { reqLower, adapters, profileId, filesText, memories });
    return { agent, ...res };
  })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.agent.id.localeCompare(b.agent.id));

  let primary = scored[0]?.agent || resolveSpecialist(taskState?.agent_role || 'fullstack-engineer');
  if (complexity.id === 'RELEASE') {
    const rel = resolveSpecialist('release-verifier');
    if (rel) primary = rel;
  }

  const supporting = [];
  const maxSupporting = complexity.maxAgents - 1;
  for (const item of scored) {
    if (supporting.length >= maxSupporting) break;
    if (item.agent.id === primary.id) continue;
    if (item.score < 12 && supporting.length > 0) continue;
    supporting.push(item.agent);
  }

  if (complexity.id === 'RELEASE') {
    for (const mustId of ['security-reviewer', 'deployment-advisor']) {
      if (supporting.length < maxSupporting && primary.id !== mustId && !supporting.some(a => a.id === mustId)) {
        supporting.push(resolveSpecialist(mustId));
      }
    }
  }

  const selectedAll = [primary, ...supporting];
  const skillsSet = new Set();
  for (const ag of selectedAll) {
    for (const sk of ag.toolsAndSkills || []) {
      skillsSet.add(sk);
    }
  }
  // Context-sensitive pstack/ponytail selection
  skillsSet.add('poteto-mode');
  skillsSet.add('ponytail');
  const selectedSkills = [...skillsSet].slice(0, complexity.maxSkills + 2);

  const references = [];
  if (complexity.loadReferences) {
    for (const sk of selectedSkills) {
      if (sk.startsWith('eng-')) references.push(`.agents/skills/${sk}/references/playbook.md`);
    }
  }

  const implAgents = selectedAll.filter(a => a.category === 'engineering' || a.category === 'game-development');
  const parallelizableGroups = implAgents.length > 1 && complexity.id !== 'FAST'
    ? implAgents.map(a => ({ specialist: a.id, boundary: `Isolated git worktree (factory/<task>-${a.id})` }))
    : [];

  const verificationPlan = [];
  if (complexity.id === 'FAST') {
    verificationPlan.push('Run targeted test/check for modified module only.');
  } else {
    verificationPlan.push('Run `factory verify .` (secret scan + configured lint/typecheck/test/build gates).');
    if (selectedAll.some(a => a.id === 'security-reviewer') || complexity.id === 'DEEP' || complexity.id === 'RELEASE') {
      verificationPlan.push('Run `factory review .` security & diff hygiene review.');
    }
    if (complexity.id === 'RELEASE') {
      verificationPlan.push('Run `factory release .` and stop for explicit human approval.');
    }
  }

  return {
    request,
    profile_id: profileId,
    complexity: complexity.id,
    pstack_mode: complexity.pstackMode,
    ponytail_mode: complexity.ponytailMode,
    primary_agent: primary.id,
    primary_legacy_role: primary.legacyRole,
    supporting_agents: supporting.map(a => a.id),
    selected_skills: selectedSkills,
    references,
    parallelizable_groups: parallelizableGroups,
    verification_plan: verificationPlan,
    scores: scored.slice(0, 8).map(s => ({ id: s.agent.id, score: s.score, reasons: s.reasons }))
  };
}

/** Human-readable explanation of an agent routing decision. */
export function explainSelection(selection) {
  return [
    `Mode: ${selection.complexity} (pstack=${selection.pstack_mode}, ponytail=${selection.ponytail_mode}) | Profile: ${selection.profile_id}`,
    `Primary Specialist: ${selection.primary_agent} (legacyRole=${selection.primary_legacy_role})`,
    `Supporting Specialists: ${selection.supporting_agents.length ? selection.supporting_agents.join(', ') : 'none'}`,
    `Selected Skills: ${selection.selected_skills.join(', ')}`,
    `Lazy References: ${selection.references.length ? selection.references.join(', ') : 'deferred (on-demand)'}`,
    `Verification Plan: ${selection.verification_plan.join(' | ')}`
  ].join('\n');
}
