import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { defaultGlobalHome, defaultGlobalMemoryDbPath, openFactoryDb } from './db.mjs';
import { detectSensitiveMemoryContent, redactSecrets } from './security.mjs';

const stamp = () => new Date().toISOString();

export const VALID_MEMORY_TYPES = [
  'observation',
  'candidate_lesson',
  'verified_lesson',
  'explicit_preference',
  'inferred_preference',
  'deprecated_lesson'
];

/** Compute deterministic deduplication fingerprint for a memory statement. */
export function memoryFingerprint({ scope = 'project', project_id = null, category = 'engineering', statement = '' }) {
  const norm = `${scope}|${scope === 'project' ? (project_id || '') : 'global'}|${String(category).toLowerCase()}|${String(statement).toLowerCase().replace(/\s+/g, ' ').trim()}`;
  return createHash('sha256').update(norm, 'utf8').digest('hex').slice(0, 24);
}

/** Open or initialize the global persistent memory SQLite DB outside individual repos. */
export function openGlobalMemoryDb(globalHome = defaultGlobalHome()) {
  const dbPath = process.env.FACTORY_GLOBAL_MEMORY_DB
    ? resolve(process.env.FACTORY_GLOBAL_MEMORY_DB)
    : join(resolve(globalHome), 'memory', 'global-memory.db');
  return openFactoryDb(dbPath);
}

/** Assert statement and evidence contain zero secrets, PII, or biometric records. */
function assertSafeMemoryPayload({ statement, evidence_ref }) {
  const stmtCheck = detectSensitiveMemoryContent(statement);
  if (!stmtCheck.ok) {
    throw new Error(`Rejected sensitive memory content (${stmtCheck.reasons.join(', ')}). Never store secrets, PII, or biometric records in factory memory.`);
  }
  if (evidence_ref) {
    const evCheck = detectSensitiveMemoryContent(evidence_ref);
    if (!evCheck.ok) {
      throw new Error(`Rejected sensitive evidence reference (${evCheck.reasons.join(', ')}).`);
    }
  }
}

/** Save Level 1 temporary working memory for a single task under .factory/tasks/<id>.memory.json. */
export function saveTaskMemory(projectPath, taskId, data = {}) {
  const payload = {
    task_id: taskId,
    objective: data.objective || '',
    files: Array.isArray(data.files) ? data.files : [],
    decisions: Array.isArray(data.decisions) ? data.decisions : [],
    testing_results: data.testing_results || null,
    blockers: Array.isArray(data.blockers) ? data.blockers : [],
    continuation: data.continuation || '',
    updated_at: stamp()
  };
  assertSafeMemoryPayload({ statement: JSON.stringify(payload), evidence_ref: null });
  const filePath = join(resolve(projectPath), '.factory', 'tasks', `${taskId}.memory.json`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return payload;
}

/** Read Level 1 task memory if present. */
export function readTaskMemory(projectPath, taskId) {
  const filePath = join(resolve(projectPath), '.factory', 'tasks', `${taskId}.memory.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/** Persist a structured memory with verification, deduplication, and safety safeguards. */
export function recordMemory(db, input) {
  const statement = String(input?.statement || '').trim();
  if (!statement) throw new Error('Memory statement cannot be empty');
  const scope = input.scope === 'global' ? 'global' : 'project';
  const category = String(input.category || 'engineering').trim().toLowerCase();
  const projectId = input.project_id || null;
  let type = VALID_MEMORY_TYPES.includes(input.type) ? input.type : 'observation';
  const sourceType = input.source_type || (type === 'explicit_preference' ? 'explicit_user' : 'inferred_from_work');
  const taskStatus = String(input.taskStatus || '').toLowerCase();

  assertSafeMemoryPayload({ statement, evidence_ref: input.evidence_ref });

  // Safeguard: Failed/blocked tasks cannot become positive verified patterns.
  if (['failed', 'blocked'].includes(taskStatus) && type === 'verified_lesson' && !['failures', 'mistakes-to-avoid'].includes(category)) {
    throw new Error('Failed or blocked tasks cannot be recorded as a positive verified_lesson pattern. Record under category "failures" or "mistakes-to-avoid".');
  }

  // Safeguard: Unverified assertions or AI guesses cannot enter verified status directly.
  let verificationStatus = input.verification_status || 'candidate';
  if (sourceType === 'ai_assertion' && !input.verified) {
    if (type === 'verified_lesson') type = 'candidate_lesson';
    verificationStatus = 'candidate';
  }
  // Safeguard: Inferred preferences always require explicit human approval before global enforcement.
  if (type === 'inferred_preference' && !input._approvedPromotion) {
    verificationStatus = 'candidate';
  }
  if (type === 'verified_lesson' && !input.evidence_ref && !input.verified) {
    type = 'candidate_lesson';
    verificationStatus = 'candidate';
  }
  if (type === 'explicit_preference' && input.verification_status == null) {
    verificationStatus = 'approved';
  }

  const fingerprint = memoryFingerprint({ scope, project_id: projectId, category, statement });
  const existing = db.findMemoryByFingerprint(fingerprint);
  if (existing && existing.status === 'active') {
    const mergedEvidence = [existing.evidence_ref, input.evidence_ref].filter(Boolean);
    const uniqueEv = [...new Set(mergedEvidence)].join(' | ');
    const mergedTags = [...new Set([...(existing.tags || []), ...(input.tags || [])])];
    return db.upsertMemory({
      ...existing,
      type: existing.type === 'candidate_lesson' && type === 'verified_lesson' ? 'verified_lesson' : existing.type,
      verification_status: verificationStatus === 'approved' ? 'approved' : existing.verification_status,
      evidence_ref: uniqueEv || null,
      tags: mergedTags,
      confidence: Number(Math.min(0.99, Math.max(existing.confidence, Number(input.confidence ?? 0.6)) + 0.05).toFixed(2)),
      version: Number(existing.version || 1) + 1,
      updated_at: stamp()
    });
  }

  return db.upsertMemory({
    type,
    scope,
    project_id: projectId,
    category,
    statement,
    evidence_ref: input.evidence_ref || null,
    source_type: sourceType,
    confidence: Number(input.confidence ?? (verificationStatus === 'approved' || verificationStatus === 'verified' ? 0.85 : 0.6)),
    verification_status: verificationStatus,
    tags: Array.isArray(input.tags) ? input.tags : [],
    profile_scope: input.profile_scope || null,
    version: 1,
    status: 'active',
    fingerprint
  });
}

/** Approve a candidate lesson or preference, optionally promoting it into Global Factory Memory. */
export function approveMemory(sourceDb, id, { by = 'owner', promoteToGlobalDb = null } = {}) {
  const mem = sourceDb.getMemory(id);
  if (!mem) throw new Error(`Memory not found: ${id}`);
  assertSafeMemoryPayload({ statement: mem.statement, evidence_ref: mem.evidence_ref });

  const promotedType = mem.type === 'candidate_lesson' || mem.type === 'observation'
    ? 'verified_lesson'
    : mem.type;

  const updatedLocal = sourceDb.upsertMemory({
    ...mem,
    type: promotedType,
    verification_status: 'approved',
    evidence_ref: [mem.evidence_ref, `approved by ${by}`].filter(Boolean).join(' | '),
    confidence: Number(Math.min(0.99, Math.max(mem.confidence, 0.85)).toFixed(2)),
    updated_at: stamp()
  });

  let globalCopy = null;
  if (promoteToGlobalDb) {
    globalCopy = recordMemory(promoteToGlobalDb, {
      ...updatedLocal,
      id: undefined,
      scope: 'global',
      _approvedPromotion: true,
      verification_status: 'approved',
      evidence_ref: [mem.evidence_ref, `source_project=${mem.project_id || 'unknown'}`, `approved_by=${by}`].filter(Boolean).join(' | '),
      verified: true
    });
  }

  return { local: updatedLocal, global: globalCopy };
}

export function rejectMemory(db, id, reason = 'Rejected during review') {
  const mem = db.getMemory(id);
  if (!mem) throw new Error(`Memory not found: ${id}`);
  return db.upsertMemory({
    ...mem,
    status: 'disabled',
    verification_status: 'rejected',
    evidence_ref: [mem.evidence_ref, `rejected: ${reason}`].filter(Boolean).join(' | '),
    updated_at: stamp()
  });
}

export function disableMemory(db, id) {
  return db.updateMemoryStatus(id, { status: 'disabled', verification_status: null });
}

export function deleteMemory(db, id) {
  return db.deleteMemory(id);
}

function tokenSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Consolidate near-duplicate lessons and mark stale unverified entries deprecated. */
export function consolidateMemories(db, { staleDays = 180, projectId = null } = {}) {
  const all = db.listMemories({ projectId, status: 'active', limit: 500 });
  const cutoffMs = Date.now() - staleDays * 86400 * 1000;
  let consolidated = 0;
  let stale = 0;
  const kept = [];

  for (const item of all) {
    const tokens = tokenSet(item.statement);
    const match = kept.find(
      k =>
        k.scope === item.scope &&
        (k.project_id || '') === (item.project_id || '') &&
        k.category === item.category &&
        jaccard(tokenSet(k.statement), tokens) >= 0.85
    );
    if (match) {
      db.upsertMemory({
        ...item,
        type: 'deprecated_lesson',
        status: 'deprecated',
        evidence_ref: [item.evidence_ref, `consolidated into ${match.id}`].filter(Boolean).join(' | '),
        updated_at: stamp()
      });
      consolidated += 1;
      continue;
    }

    const lastTouch = Date.parse(item.last_used_at || item.updated_at || item.created_at);
    if (Number.isFinite(lastTouch) && lastTouch < cutoffMs && item.verification_status !== 'approved' && item.type !== 'explicit_preference') {
      db.upsertMemory({
        ...item,
        type: 'deprecated_lesson',
        status: 'deprecated',
        evidence_ref: [item.evidence_ref, `stale >${staleDays}d`].filter(Boolean).join(' | '),
        updated_at: stamp()
      });
      stale += 1;
      continue;
    }

    kept.push(item);
  }

  return { consolidated_count: consolidated, stale_count: stale, total_active: kept.length };
}

function formatMemorySection(title, rows) {
  if (!rows.length) return `# ${title}\n\n_No entries recorded yet._\n`;
  return [
    `# ${title}`,
    ``,
    ...rows.map(m =>
      `- **[${m.verification_status}]** (${m.category}, \`${m.type}\`, source=\`${m.source_type}\`, conf=${m.confidence}${m.profile_scope ? `, profile=${m.profile_scope}` : ''}) — ${m.statement}` +
      (m.evidence_ref ? ` *(evidence: ${m.evidence_ref})*` : '')
    ),
    ``
  ].join('\n');
}

/** Render human-readable Level 2 Project Memory Markdown views under .factory/memory/. */
export function syncProjectMemoryViews(projectPath, projectDb, projectId) {
  const memDir = join(resolve(projectPath), '.factory', 'memory');
  mkdirSync(memDir, { recursive: true });
  const proj = projectDb.getProject(projectId) || projectDb.getProject(projectPath);
  const profile = projectDb.getProjectProfile(projectId);
  const tasks = projectDb.listTasks(projectId);
  const memories = projectDb.listMemories({ scope: 'project', projectId, status: 'active', limit: 300 });

  const decisions = memories.filter(m => ['architecture', 'decision', 'stack'].includes(m.category));
  const failures = memories.filter(m => ['failures', 'mistakes-to-avoid', 'bugfix'].includes(m.category));
  const lessons = memories.filter(m => !decisions.includes(m) && !failures.includes(m));

  const activePrefs = memories.filter(m => m.type === 'explicit_preference' || m.type === 'inferred_preference');
  const overviewMd = [
    `# Project Memory`,
    ``,
    `- **Project:** ${proj?.name || projectId}`,
    `- **Profile:** ${profile?.profile_id || 'generic'}`,
    `- **Detected Adapters:** ${(proj?.adapter_ids || []).join(', ') || 'none'}`,
    `- **Updated:** ${stamp()}`,
    ``,
    `## Active Preferences & Constraints`,
    ...(activePrefs.length ? activePrefs.map(m => `- [${m.verification_status}] (${m.source_type}) ${m.statement}`) : ['- None recorded']),
    ``
  ].join('\n');

  const progressMd = [
    `# Project Progress`,
    ``,
    `- **Total Tasks:** ${tasks.length}`,
    `- **Completed / Verified / Approved:** ${tasks.filter(t => ['completed', 'verified', 'approved'].includes(t.status)).length}`,
    `- **Blocked / Failed:** ${tasks.filter(t => ['blocked', 'failed'].includes(t.status)).length}`,
    `- **Pending / Active:** ${tasks.filter(t => ['queued', 'planning', 'running', 'awaiting_agent'].includes(t.status)).length}`,
    ``,
    ...tasks.slice(0, 30).map(t => `- \`${t.id}\` [${t.status}] (${t.agent_role}): ${t.title}`),
    ``
  ].join('\n');

  writeFileSync(join(memDir, 'project-memory.md'), overviewMd, 'utf8');
  writeFileSync(join(memDir, 'decisions.md'), formatMemorySection('Architectural & Stack Decisions', decisions), 'utf8');
  writeFileSync(join(memDir, 'lessons.md'), formatMemorySection('Verified Engineering Lessons', lessons), 'utf8');
  writeFileSync(join(memDir, 'progress.md'), progressMd, 'utf8');
  writeFileSync(join(memDir, 'failures.md'), formatMemorySection('Failures, Root Causes & Fixes', failures), 'utf8');
  return memDir;
}

/** Render human-readable Level 3 Global Memory Markdown views outside repositories. */
export function syncGlobalMemoryViews(globalHome = defaultGlobalHome(), globalDb = null) {
  const ownsDb = !globalDb;
  const db = globalDb || openGlobalMemoryDb(globalHome);
  try {
    const memDir = join(resolve(globalHome), 'memory');
    mkdirSync(memDir, { recursive: true });
    const all = db.listMemories({ scope: 'global', status: 'active', limit: 500 });

    const prefs = all.filter(m => m.type === 'explicit_preference' || m.type === 'inferred_preference');
    const explicit = prefs.filter(m => m.source_type === 'explicit_user');
    const inferredApproved = prefs.filter(m => m.source_type !== 'explicit_user' && m.verification_status === 'approved');
    const inferredPending = prefs.filter(m => m.source_type !== 'explicit_user' && m.verification_status !== 'approved');

    const prefsMd = [
      `# Global User Preferences`,
      ``,
      `## Explicitly Stated Preferences`,
      ...(explicit.length ? explicit.map(m => `- ${m.statement} *(conf=${m.confidence})*`) : ['_None recorded._']),
      ``,
      `## Approved Inferred Preferences`,
      ...(inferredApproved.length ? inferredApproved.map(m => `- ${m.statement} *(source project=${m.project_id || 'n/a'})*`) : ['_None recorded._']),
      ``,
      `## Pending Candidate Preferences (Awaiting Approval)`,
      ...(inferredPending.length ? inferredPending.map(m => `- [${m.id}] ${m.statement}`) : ['_None pending._']),
      ``
    ].join('\n');

    writeFileSync(join(memDir, 'user-preferences.md'), prefsMd, 'utf8');
    writeFileSync(join(memDir, 'engineering-lessons.md'), formatMemorySection('Global Engineering Lessons', all.filter(m => m.category === 'engineering')), 'utf8');
    writeFileSync(join(memDir, 'ui-ux-preferences.md'), formatMemorySection('Global UI/UX Preferences', all.filter(m => m.category === 'ui-ux' || m.category === 'ui')), 'utf8');
    writeFileSync(join(memDir, 'architecture-patterns.md'), formatMemorySection('Global Architecture Patterns', all.filter(m => m.category === 'architecture')), 'utf8');
    writeFileSync(join(memDir, 'deployment-lessons.md'), formatMemorySection('Global Deployment Lessons', all.filter(m => m.category === 'deployment')), 'utf8');
    writeFileSync(join(memDir, 'mistakes-to-avoid.md'), formatMemorySection('Global Mistakes to Avoid', all.filter(m => m.category === 'mistakes-to-avoid' || m.category === 'failures')), 'utf8');
    return memDir;
  } finally {
    if (ownsDb) db.close();
  }
}

function isProfileCompatible(memProfile, activeProfile, adapters, queryTokens) {
  if (!memProfile || memProfile === 'generic') return true;
  if (activeProfile && memProfile === activeProfile) return true;
  if (adapters.some(a => memProfile.includes(a) || a.includes(memProfile))) return true;
  if (queryTokens.has(memProfile)) return true;
  return false;
}

/** Retrieve strictly relevant project + approved global memories without cross-project leakage. */
export function retrieveRelevantMemories({
  projectDb,
  globalDb = null,
  projectId,
  profileId = 'generic',
  stack = [],
  query = '',
  limit = 8
}) {
  const qTokens = tokenSet(`${query} ${(stack || []).join(' ')} ${profileId || ''}`);
  const adapters = (stack || []).map(s => String(s).toLowerCase());
  const projectMemories = projectId && projectDb
    ? projectDb.listMemories({ scope: 'project', projectId, status: 'active', limit: 100 })
    : [];

  const globalRaw = globalDb
    ? globalDb.listMemories({ scope: 'global', status: 'active', limit: 200 })
        .filter(m => m.verification_status === 'approved' || m.verification_status === 'verified')
    : [];

  const filteredGlobal = [];
  for (const g of globalRaw) {
    if (!isProfileCompatible(g.profile_scope, profileId, adapters, qTokens)) continue;
    filteredGlobal.push(g);
  }

  function score(mem, isProject) {
    let s = isProject ? 30 : 10;
    if (mem.profile_scope && mem.profile_scope === profileId) s += 15;
    if (mem.type === 'explicit_preference') s += 6;
    if (mem.verification_status === 'approved' || mem.verification_status === 'verified') s += 5;
    const mTokens = tokenSet(`${mem.category} ${mem.statement} ${(mem.tags || []).join(' ')}`);
    for (const t of qTokens) {
      if (mTokens.has(t)) s += 6;
    }
    return s;
  }

  // Detect project-level overrides of conflicting global preferences/patterns in the same category
  const projectByCategory = new Map();
  for (const pm of projectMemories) {
    if (!projectByCategory.has(pm.category)) projectByCategory.set(pm.category, []);
    projectByCategory.get(pm.category).push(pm);
  }

  const overridden = [];
  const candidates = [];

  for (const pm of projectMemories) {
    candidates.push({ ...pm, origin: 'project', score: score(pm, true), overridden_by_project: false });
  }

  for (const gm of filteredGlobal) {
    const sameCatProj = projectByCategory.get(gm.category) || [];
    const hasConflict = sameCatProj.some(pm =>
      pm.type === 'explicit_preference' ||
      /\b(override|instead|never|disable|use .* instead|only use)\b/i.test(pm.statement)
    );
    if (hasConflict) {
      overridden.push({ ...gm, origin: 'global', overridden_by_project: true });
      continue;
    }
    const gScore = score(gm, false);
    if (qTokens.size > 0 && gScore < 16 && !gm.profile_scope) {
      // Allow high-confidence general rules, skip completely unrelated items
      if (gm.confidence < 0.85) continue;
    }
    candidates.push({ ...gm, origin: 'global', score: gScore, overridden_by_project: false });
  }

  candidates.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  const items = candidates.slice(0, limit);

  if (projectDb) {
    const projIds = items.filter(i => i.origin === 'project').map(i => i.id);
    if (projIds.length) projectDb.touchMemories(projIds);
  }
  if (globalDb) {
    const globIds = items.filter(i => i.origin === 'global').map(i => i.id);
    if (globIds.length) globalDb.touchMemories(globIds);
  }

  return {
    items,
    overridden,
    counts: {
      project_returned: items.filter(i => i.origin === 'project').length,
      global_returned: items.filter(i => i.origin === 'global').length,
      overridden_count: overridden.length
    }
  };
}

/** Extract structured observations/lessons from verified tasks, gates, or user feedback. */
export function learnFromProject({
  projectPath,
  projectDb,
  globalDb = null,
  taskId = null,
  fromFeedback = false,
  statement = null,
  category = 'engineering',
  explicit = false,
  evidence = null,
  profileScope = null,
  tags = []
}) {
  const proj = projectDb.getProject(projectPath);
  if (!proj) throw new Error(`Project not registered: ${projectPath}`);
  const profile = profileScope || projectDb.getProjectProfile(proj.id)?.profile_id || 'generic';
  const recorded = [];

  if (statement) {
    const type = explicit
      ? 'explicit_preference'
      : (fromFeedback ? 'inferred_preference' : 'candidate_lesson');
    const sourceType = explicit ? 'explicit_user' : (fromFeedback ? 'user_feedback' : 'inferred_from_work');
    const mem = recordMemory(projectDb, {
      type,
      scope: 'project',
      project_id: proj.id,
      category,
      statement,
      evidence_ref: evidence || (explicit ? 'Explicit user instruction' : 'Recorded feedback'),
      source_type: sourceType,
      verification_status: explicit ? 'approved' : 'candidate',
      profile_scope: profile,
      tags: [...new Set([...tags, ...(proj.adapter_ids || [])])],
      verified: explicit
    });
    recorded.push(mem);

    if (globalDb && (type === 'inferred_preference' || explicit)) {
      recordMemory(globalDb, {
        type,
        scope: 'global',
        project_id: proj.id,
        category,
        statement,
        evidence_ref: evidence || `source_project=${proj.id}`,
        source_type: sourceType,
        verification_status: explicit ? 'approved' : 'candidate',
        profile_scope: profile,
        tags: [...new Set([...tags, ...(proj.adapter_ids || [])])],
        verified: explicit
      });
    }
  }

  if (taskId) {
    const task = projectDb.getTask(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    if (task.status === 'failed' || task.status === 'blocked') {
      recorded.push(recordMemory(projectDb, {
        type: 'observation',
        scope: 'project',
        project_id: proj.id,
        category: 'failures',
        statement: `Task "${task.title}" (${task.id}) failed/blocked: ${task.last_error || 'Check gate output'}`,
        evidence_ref: `task:${task.id}`,
        source_type: 'gate_failure',
        verification_status: 'candidate',
        taskStatus: task.status,
        profile_scope: profile,
        tags: [task.agent_role]
      }));
    } else if (task.verification?.ok || ['verified', 'approved'].includes(task.status)) {
      recorded.push(recordMemory(projectDb, {
        type: 'verified_lesson',
        scope: 'project',
        project_id: proj.id,
        category,
        statement: `Verified implementation "${task.title}" passed gates (${task.verification?.metrics?.passed_gates ?? 'all'} checks on ${task.verification?.revision || 'HEAD'})`,
        evidence_ref: `task:${task.id}@${task.verification?.revision || 'workspace'}`,
        source_type: 'verified_task',
        verification_status: 'verified',
        verified: true,
        profile_scope: profile,
        tags: [task.agent_role, ...(proj.adapter_ids || [])]
      }));
    }
  }

  syncProjectMemoryViews(projectPath, projectDb, proj.id);
  if (globalDb) {
    const parentName = dirname(globalDb.path).split(/[\\/]/).pop();
    const homeDir = parentName === 'memory' ? dirname(dirname(globalDb.path)) : defaultGlobalHome();
    syncGlobalMemoryViews(homeDir, globalDb);
  }
  return recorded;
}

/** Export portable (optionally AES-256-GCM encrypted) memory archive. */
export function exportMemories(db, { filePath, scope = null, projectId = null, includeCandidates = false, passphrase = null }) {
  const rows = db.listMemories({ scope, projectId, status: 'active', limit: 2000 })
    .filter(m => includeCandidates || m.verification_status === 'approved' || m.verification_status === 'verified' || m.type === 'explicit_preference');

  const safeRows = rows.map(r => ({
    ...r,
    statement: redactSecrets(r.statement),
    evidence_ref: r.evidence_ref ? redactSecrets(r.evidence_ref) : null
  }));
  const plaintext = JSON.stringify(safeRows);
  const sha256 = createHash('sha256').update(plaintext, 'utf8').digest('hex');

  let archive;
  if (passphrase) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(String(passphrase), salt, 32);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    archive = {
      schema: 1,
      exported_at: stamp(),
      encrypted: true,
      kdf: 'scrypt-aes-256-gcm',
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: authTag.toString('hex'),
      sha256,
      count: safeRows.length,
      payload: encrypted.toString('base64')
    };
  } else {
    archive = {
      schema: 1,
      exported_at: stamp(),
      encrypted: false,
      sha256,
      count: safeRows.length,
      entries: safeRows
    };
  }

  const outPath = resolve(filePath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(archive, null, 2) + '\n', 'utf8');
  return { file: outPath, count: safeRows.length, encrypted: Boolean(passphrase), sha256 };
}

/** Import and verify memories from an exported (plain or encrypted) JSON archive. */
export function importMemories(db, filePath, { passphrase = null, targetScope = null } = {}) {
  const archive = JSON.parse(readFileSync(resolve(filePath), 'utf8'));
  let plaintext;
  if (archive.encrypted) {
    if (!passphrase) throw new Error('Passphrase is required to decrypt encrypted memory archive');
    const key = scryptSync(String(passphrase), Buffer.from(archive.salt, 'hex'), 32);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(archive.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(archive.tag, 'hex'));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(archive.payload, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } else {
    plaintext = JSON.stringify(archive.entries || []);
  }

  const digest = createHash('sha256').update(plaintext, 'utf8').digest('hex');
  if (archive.sha256 && digest !== archive.sha256) {
    throw new Error('Memory archive checksum mismatch: refusing potentially corrupted import');
  }

  const entries = JSON.parse(plaintext);
  const imported = [];
  for (const item of entries) {
    assertSafeMemoryPayload({ statement: item.statement, evidence_ref: item.evidence_ref });
    const rec = recordMemory(db, {
      ...item,
      id: undefined,
      scope: targetScope || item.scope || 'global',
      _approvedPromotion: item.verification_status === 'approved',
      verified: item.verification_status === 'verified' || item.verification_status === 'approved'
    });
    imported.push(rec);
  }
  return { imported_count: imported.length, items: imported };
}
