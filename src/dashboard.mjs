import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { AGENT_ROLES, PIPELINE_STAGES, detectProviders } from './agents.mjs';
import { AGENT_CATEGORIES, SPECIALIST_AGENTS } from './agent-registry.mjs';
import { detectRuntimes } from './adapters.mjs';
import { recommendSkills } from './skills-engine.mjs';

function htmlEscape(x) {
  return String(x ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmtTime(iso) {
  return iso ? String(iso).replace('T', ' ').slice(0, 19) : '—';
}

function badgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (['approved', 'verified', 'completed', 'pass', 'ready_for_release', 'resolved'].includes(s)) return 'ok';
  if (['blocked', 'failed', 'fail', 'critical', 'high', 'rejected'].includes(s)) return 'bad';
  if (['running', 'active', 'awaiting_agent', 'pending', 'pending_approval', 'not verified'].includes(s)) return 'warn';
  return 'neutral';
}

export function buildDashboardSnapshot({ db, globalDb = null, activeProjectPath = null, version = '1.0.0' }) {
  const projects = db.listProjects();
  const activeProject = activeProjectPath
    ? (db.getProject(activeProjectPath) || projects[0] || null)
    : (projects[0] || null);

  const tasks = activeProject ? db.listTasks(activeProject.id) : [];
  const pipelines = activeProject ? db.listPipelines(activeProject.id) : [];
  const logs = activeProject ? db.listLogs(activeProject.id, 60) : db.listLogs(null, 60);
  const gateRuns = activeProject ? db.listGateRuns(activeProject.id, 15) : [];
  const securityFindings = activeProject ? db.listSecurityFindings(activeProject.id, 50) : [];
  const reviewFindings = activeProject ? db.listReviewFindings(activeProject.id, 50) : [];
  const releases = activeProject ? db.listReleases(activeProject.id, 20) : [];
  const approvals = activeProject ? db.listApprovals(activeProject.id, 30) : db.listApprovals(null, 30);
  const agentRuns = activeProject ? db.listAgentRuns(activeProject.id, 40) : [];

  const activeProfile = activeProject ? db.getProjectProfile(activeProject.id) : null;
  const routingDecisions = activeProject ? db.listRoutingDecisions(activeProject.id, 30) : db.listRoutingDecisions(null, 30);
  const skillRegistry = db.listSkillRecords();
  const suggestedSkills = activeProject && existsSync(activeProject.path)
    ? recommendSkills(activeProject.path, { offline: true }).recommended
    : [];
  const projectMemories = activeProject ? db.listMemories({ scope: 'project', projectId: activeProject.id, limit: 60 }) : [];
  const globalMemories = globalDb ? globalDb.listMemories({ scope: 'global', limit: 80 }) : [];
  const candidateMemories = [
    ...projectMemories.filter(m => m.verification_status === 'candidate'),
    ...globalMemories.filter(m => m.verification_status === 'candidate')
  ];
  const approvedPreferences = [
    ...projectMemories.filter(m => (m.type === 'explicit_preference' || m.type === 'inferred_preference') && m.verification_status === 'approved'),
    ...globalMemories.filter(m => (m.type === 'explicit_preference' || m.type === 'inferred_preference') && m.verification_status === 'approved')
  ];
  const updateHistory = globalDb ? globalDb.listUpdateHistory(20) : db.listUpdateHistory(20);
  const contextMetrics = activeProject ? db.listContextMetrics(activeProject.id, 30) : db.listContextMetrics(null, 30);
  const deploymentAdvice = activeProject ? db.listDeploymentAdvice(activeProject.id, 10) : db.listDeploymentAdvice(null, 10);
  const improvementProposals = db.listImprovementProposals(null, 20);

  return {
    generated_at: new Date().toISOString(),
    version,
    schema_version: typeof db.schemaVersion === 'function' ? db.schemaVersion() : 2,
    db_path: db.path,
    health: {
      node: process.version,
      sqlite: true,
      runtimes: detectRuntimes(),
      providers: detectProviders()
    },
    projects,
    activeProject,
    activeProfile,
    pipelines,
    tasks,
    logs,
    gateRuns,
    securityFindings,
    reviewFindings,
    releases,
    approvals,
    agentRuns,
    specialists: SPECIALIST_AGENTS.map(s => ({ id: s.id, name: s.name, category: s.category, legacyRole: s.legacyRole, readonly: s.readonly })),
    specialistCategories: AGENT_CATEGORIES,
    routingDecisions,
    skillRegistry,
    suggestedSkills,
    projectMemories,
    globalMemories,
    candidateMemories,
    approvedPreferences,
    updateHistory,
    contextMetrics,
    deploymentAdvice,
    improvementProposals
  };
}

function renderDashboardHtml(snapshot, version) {
  const { activeProject, projects, pipelines, tasks, logs, gateRuns, securityFindings, reviewFindings, releases, approvals, agentRuns, health } = snapshot;

  const counts = {
    total: tasks.length,
    active: tasks.filter(t => ['queued', 'planning', 'running', 'awaiting_agent'].includes(t.status)).length,
    completed: tasks.filter(t => ['completed', 'verified', 'approved'].includes(t.status)).length,
    blocked: tasks.filter(t => ['blocked', 'failed'].includes(t.status)).length,
    approvalsPending: approvals.filter(a => a.status === 'pending').length
  };

  const latestPipeline = pipelines[0] || null;
  const stageBar = PIPELINE_STAGES.map(st => {
    const isCurrent = latestPipeline?.current_stage === st;
    return `<span class="stage ${isCurrent ? 'current' : ''}">${htmlEscape(st.replaceAll('_', ' '))}</span>`;
  }).join('');

  const projectLinks = projects.map(p => {
    const selected = activeProject && p.id === activeProject.id;
    return `<a class="proj-chip ${selected ? 'active' : ''}" href="/?project=${encodeURIComponent(p.id)}">${htmlEscape(p.name)} <span>(${htmlEscape(p.adapter_ids.join(', ') || 'generic')})</span></a>`;
  }).join('');

  const taskRows = tasks.map(t => {
    const deps = (t.depends_on || []).length ? `<small>deps: ${htmlEscape(t.depends_on.join(', '))}</small>` : '';
    const err = t.last_error ? `<small class="err-text">${htmlEscape(t.last_error)}</small>` : '';
    return `<tr>
      <td><strong>${htmlEscape(t.title)}</strong><small>${htmlEscape(t.id)} · stage: ${htmlEscape(t.stage)}</small>${deps}${err}</td>
      <td><code>${htmlEscape(t.agent_role)}</code></td>
      <td><span class="pill ${badgeClass(t.status)}">${htmlEscape(t.status)}</span><small>attempts: ${t.attempts}/${t.max_retries}</small></td>
      <td>${t.verification ? `<span class="pill ${t.verification.ok ? 'ok' : 'bad'}">${t.verification.ok ? 'PASS' : 'FAIL'}</span>` : '<span class="pill neutral">NOT RUN</span>'}</td>
      <td><code>${htmlEscape(t.branch || '—')}</code></td>
      <td>${htmlEscape(fmtTime(t.updated_at))}</td>
    </tr>`;
  }).join('');

  const blockerRows = tasks.filter(t => t.status === 'blocked' || t.status === 'failed' || t.status === 'awaiting_agent').map(t => `
    <tr>
      <td><strong>${htmlEscape(t.title)}</strong><small>${htmlEscape(t.id)}</small></td>
      <td><span class="pill ${badgeClass(t.status)}">${htmlEscape(t.status)}</span></td>
      <td>${htmlEscape(t.last_error || (t.status === 'awaiting_agent' ? 'Awaiting Antigravity IDE /factory-build execution' : 'Gate failure'))}</td>
    </tr>
  `).join('');

  const gateRows = gateRuns.map(g => {
    const details = (g.results || []).map(r => `<span class="pill ${badgeClass(r.status || (r.ok ? 'pass' : 'fail'))}">${htmlEscape(r.name)}: ${htmlEscape(r.status || (r.ok ? 'PASS' : 'FAIL'))}</span>`).join(' ');
    return `<tr>
      <td>${htmlEscape(fmtTime(g.created_at))}<small>${htmlEscape(g.task_id || 'project')}</small></td>
      <td><span class="pill ${g.ok ? 'ok' : 'bad'}">${g.ok ? 'PASS' : 'BLOCKED'}</span></td>
      <td>${g.metrics?.gate_pass_rate ?? 0}% (${g.metrics?.passed_gates ?? 0}/${g.metrics?.total_gates ?? 0})</td>
      <td><code>${htmlEscape((g.revision || 'none').slice(0, 10))}</code>${g.dirty ? ' <span class="pill warn">dirty</span>' : ''}</td>
      <td>${details}</td>
    </tr>`;
  }).join('');

  const secRows = securityFindings.map(f => `<tr>
    <td><span class="pill ${badgeClass(f.severity)}">${htmlEscape(f.severity)}</span></td>
    <td><code>${htmlEscape(f.category)}</code></td>
    <td><code>${htmlEscape(f.file_path || '—')}${f.line_number ? `:${f.line_number}` : ''}</code></td>
    <td>${htmlEscape(f.summary)}</td>
    <td><span class="pill ${badgeClass(f.status)}">${htmlEscape(f.status)}</span></td>
  </tr>`).join('');

  const revRows = reviewFindings.map(r => `<tr>
    <td><code>${htmlEscape(r.reviewer_role)}</code></td>
    <td><span class="pill ${badgeClass(r.severity)}">${htmlEscape(r.severity)}</span></td>
    <td>${htmlEscape(r.summary)}</td>
    <td><span class="pill ${badgeClass(r.status)}">${htmlEscape(r.status)}</span></td>
  </tr>`).join('');

  const relRows = releases.map(r => `<tr>
    <td><strong>${htmlEscape(r.version)}</strong><small>${htmlEscape(r.id)}</small></td>
    <td><span class="pill ${badgeClass(r.status)}">${htmlEscape(r.status)}</span></td>
    <td><code>${htmlEscape((r.revision || '—').slice(0, 10))}</code></td>
    <td>${htmlEscape(r.approved_by || '—')}</td>
    <td>${htmlEscape(r.notes)}</td>
  </tr>`).join('');

  const aprRows = approvals.map(a => `<tr>
    <td>${htmlEscape(a.action)}<small>${htmlEscape(a.id)}</small></td>
    <td><span class="pill ${badgeClass(a.status)}">${htmlEscape(a.status)}</span></td>
    <td>${htmlEscape(a.decided_by || 'Pending human')}</td>
    <td>${htmlEscape(fmtTime(a.created_at))}</td>
  </tr>`).join('');

  const agentCards = Object.values(AGENT_ROLES).map(role => {
    const assigned = tasks.filter(t => t.agent_role === role.id);
    const runs = agentRuns.filter(r => r.agent_role === role.id);
    const latest = runs[0];
    return `<div class="agent-card">
      <div class="agent-head"><strong>${htmlEscape(role.name)}</strong><span class="pill ${latest ? badgeClass(latest.status) : 'neutral'}">${htmlEscape(latest?.status || 'idle')}</span></div>
      <small>${htmlEscape(role.stage)} · ${assigned.length} task(s), ${runs.length} run(s)</small>
    </div>`;
  }).join('');

  const logRows = logs.map(l => `<div class="log-line ${badgeClass(l.level === 'error' ? 'bad' : (l.level === 'warn' ? 'warn' : 'neutral'))}">
    <span class="ts">${htmlEscape(fmtTime(l.created_at))}</span>
    <span class="role">[${htmlEscape(l.agent_role || 'factory')}]</span>
    <span class="msg">${htmlEscape(l.message)}</span>
  </div>`).join('');

  const providerRows = health.providers.map(p => `<tr>
    <td><strong>${htmlEscape(p.label)}</strong></td>
    <td><span class="pill ${p.available ? 'ok' : 'neutral'}">${p.available ? 'installed' : 'not installed'}</span></td>
    <td><span class="pill ${p.authenticated ? 'ok' : 'warn'}">${p.authenticated ? 'ready' : 'not authenticated'}</span></td>
    <td>${htmlEscape(p.notes)}</td>
  </tr>`).join('');

  const runtimeBadges = Object.entries(health.runtimes)
    .map(([k, v]) => `<span class="pill ${v ? 'ok' : 'neutral'}">${htmlEscape(k)}: ${v ? 'ok' : 'missing'}</span>`)
    .join(' ');

  const routingRows = (snapshot.routingDecisions || []).slice(0, 12).map(r => `<tr>
    <td><strong>${htmlEscape(r.primary_agent)}</strong><small>${htmlEscape((r.supporting_agents || []).join(', ') || 'solo')}</small></td>
    <td><span class="pill neutral">${htmlEscape(r.complexity)}</span></td>
    <td><code>${htmlEscape((r.selected_skills || []).join(', '))}</code></td>
    <td>${htmlEscape(r.request_summary)}</td>
  </tr>`).join('');

  const skillRows = (snapshot.skillRegistry || []).map(s => `<tr>
    <td><strong>${htmlEscape(s.name)}</strong><small>${htmlEscape(s.source)}</small></td>
    <td><span class="pill ok">${htmlEscape(s.approval_status)}</span></td>
    <td><code>${htmlEscape((s.sha256 || '—').slice(0, 12))}</code></td>
    <td>${htmlEscape(s.security_summary || 'verified')}</td>
  </tr>`).join('');

  const suggestedBadges = (snapshot.suggestedSkills || []).map(s => `<span class="pill warn">${htmlEscape(s.name)} (${htmlEscape(s.source_type || 'catalog')})</span>`).join(' ');

  const memRows = [...(snapshot.projectMemories || []), ...(snapshot.globalMemories || [])].slice(0, 15).map(m => `<tr>
    <td><span class="pill ${badgeClass(m.verification_status)}">${htmlEscape(m.scope)}:${htmlEscape(m.verification_status)}</span><small>${htmlEscape(m.source_type)}</small></td>
    <td><code>${htmlEscape(m.category)}</code></td>
    <td>${htmlEscape(m.statement)}</td>
  </tr>`).join('');

  const candidateRows = (snapshot.candidateMemories || []).slice(0, 10).map(m => `<tr>
    <td><code>${htmlEscape(m.id)}</code></td>
    <td>${htmlEscape(m.category)}</td>
    <td>${htmlEscape(m.statement)}</td>
  </tr>`).join('');

  const metricRows = (snapshot.contextMetrics || []).slice(0, 10).map(m => `<tr>
    <td><span class="pill neutral">${htmlEscape(m.mode)}</span></td>
    <td>${htmlEscape(m.estimated_context_bytes)} B / ${htmlEscape(m.baseline_context_bytes ?? '—')} B</td>
    <td>${m.input_tokens != null ? `${htmlEscape(m.input_tokens)}/${htmlEscape(m.output_tokens)}` : 'unavailable'}</td>
    <td>${htmlEscape(m.agent_invocations)}</td>
  </tr>`).join('');

  const updateRows = (snapshot.updateHistory || []).slice(0, 8).map(u => `<tr>
    <td>${htmlEscape(u.action)}</td>
    <td>${htmlEscape(u.from_version || '—')} -> ${htmlEscape(u.to_version || '—')}</td>
    <td><span class="pill ${badgeClass(u.status === 'completed' ? 'completed' : 'blocked')}">${htmlEscape(u.status)}</span></td>
    <td>${htmlEscape(fmtTime(u.created_at))}</td>
  </tr>`).join('');

  const deployRows = (snapshot.deploymentAdvice || []).slice(0, 5).map(d => `<tr>
    <td><strong>${htmlEscape(d.recommended_platform)}</strong></td>
    <td>${htmlEscape(d.profile_id || 'generic')}</td>
    <td>${htmlEscape((d.options || []).map(o => o.platform).join(', '))}</td>
    <td>${htmlEscape(fmtTime(d.created_at))}</td>
  </tr>`).join('');

  const proposalRows = (snapshot.improvementProposals || []).slice(0, 8).map(p => `<tr>
    <td><strong>${htmlEscape(p.title)}</strong><small>${htmlEscape(p.hypothesis)}</small></td>
    <td><span class="pill warn">${htmlEscape(p.status)}</span></td>
  </tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>Universal Software Factory Control Room</title>
<style>
:root{color-scheme:dark;font-family:Inter,Segoe UI,system-ui,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:#0b1118;color:#e6edf5;line-height:1.45}
main{max-width:1360px;margin:0 auto;padding:28px 20px 48px}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;border-bottom:1px solid #223042;padding-bottom:20px}
.eyebrow{color:#6ea8fe;letter-spacing:.12em;font-size:11px;font-weight:700;text-transform:uppercase}
h1{margin:6px 0;font-size:28px;font-weight:700}
h2{font-size:16px;margin:0;padding:14px 18px;border-bottom:1px solid #223042;background:#111a24}
p,small{color:#91a4b7;margin:0}
small{display:block;margin-top:4px;font-size:11px}
.err-text{color:#f59ea9}
.tag{border:1px solid #2f4663;padding:7px 12px;border-radius:99px;font-size:12px;color:#b8cbe0}
.projects{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
.proj-chip{text-decoration:none;color:#c7d6e6;background:#121b26;border:1px solid #253447;padding:8px 12px;border-radius:10px;font-size:12px}
.proj-chip.active{border-color:#539bf5;background:#162538;color:#fff}
.proj-chip span{color:#8197ae}
.stages{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}
.stage{font-size:11px;padding:4px 8px;border-radius:6px;background:#131d29;border:1px solid #223042;color:#8ea2b8;text-transform:capitalize}
.stage.current{background:#193554;border-color:#539bf5;color:#e8f2ff;font-weight:600}
.stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:20px 0}
.stat{background:#111923;padding:16px;border:1px solid #223042;border-radius:12px}
.stat span{text-transform:uppercase;font-size:11px;letter-spacing:.08em;color:#8fa3b8;display:block}
.stat strong{font-size:26px;display:block;margin-top:6px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.panel{background:#111923;border:1px solid #223042;border-radius:12px;overflow:hidden;margin-top:16px}
.grid .panel{margin-top:0}
table{width:100%;border-collapse:collapse;text-align:left}
th{color:#8397ad;font-size:11px;text-transform:uppercase;letter-spacing:.07em}
th,td{padding:11px 16px;border-top:1px solid #1e2b3b;font-size:13px;vertical-align:top}
.pill{display:inline-block;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.pill.ok{background:#143b2e;color:#6ee7b7}
.pill.bad{background:#4b1f27;color:#fca5a5}
.pill.warn{background:#423315;color:#fcd34d}
.pill.neutral{background:#233041;color:#b6c6d8}
.agents-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;padding:14px}
.agent-card{background:#0d141d;border:1px solid #1f2c3d;border-radius:8px;padding:10px 12px}
.agent-head{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px}
.logs-box{max-height:320px;overflow:auto;padding:10px 16px;font-family:Consolas,ui-monospace,monospace;font-size:12px;background:#0c121a}
.log-line{padding:4px 0;border-bottom:1px solid #16202c}
.log-line .ts{color:#72879e;margin-right:8px}
.log-line .role{color:#7ab4ff;margin-right:8px}
code,pre{font-family:Consolas,ui-monospace,monospace;font-size:12px;color:#9cc4f7}
pre{margin:0;padding:14px 16px;overflow:auto;background:#0c121a}
.pad{padding:14px 16px}
footer{margin-top:24px;color:#8296ab;font-size:12px}
@media(max-width:900px){.stats{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="eyebrow">Google Antigravity · SQLite Factory Control Room</div>
      <h1>Universal AI Software Factory</h1>
      <p>${htmlEscape(activeProject ? `${activeProject.name} (${activeProject.path})` : 'No project registered yet')} · v${htmlEscape(version)} · DB: ${htmlEscape(snapshot.db_path)}</p>
    </div>
    <span class="tag">Read-only localhost · Auto-refresh 10s</span>
  </header>

  <section class="projects">${projectLinks || '<span class="tag">Run factory init &lt;project&gt; to register a project</span>'}</section>
  <section class="stages">${stageBar}</section>

  <section class="stats">
    <article class="stat"><span>Total Tasks</span><strong>${counts.total}</strong></article>
    <article class="stat"><span>Active / Queued</span><strong>${counts.active}</strong></article>
    <article class="stat"><span>Completed / Verified</span><strong>${counts.completed}</strong></article>
    <article class="stat"><span>Blocked / Failed</span><strong>${counts.blocked}</strong></article>
    <article class="stat"><span>Pending Approvals</span><strong>${counts.approvalsPending}</strong></article>
  </section>

  <section class="panel">
    <h2>Task Queue &amp; Execution State</h2>
    <table><thead><tr><th>Task</th><th>Agent</th><th>Status</th><th>Gates</th><th>Branch</th><th>Updated (UTC)</th></tr></thead>
    <tbody>${taskRows || '<tr><td colspan="6">No tasks persisted for this project yet.</td></tr>'}</tbody></table>
  </section>

  <section class="panel">
    <h2>14-Agent Orchestra Assignments</h2>
    <div class="agents-grid">${agentCards}</div>
  </section>

  <div class="grid">
    <section class="panel">
      <h2>Blockers, Failures &amp; IDE Handoffs</h2>
      <table><thead><tr><th>Task</th><th>State</th><th>Detail</th></tr></thead>
      <tbody>${blockerRows || '<tr><td colspan="3">No active blockers or failed tasks.</td></tr>'}</tbody></table>
    </section>
    <section class="panel">
      <h2>Approval Requests</h2>
      <table><thead><tr><th>Action</th><th>Status</th><th>Decided By</th><th>Requested</th></tr></thead>
      <tbody>${aprRows || '<tr><td colspan="4">No approval requests recorded.</td></tr>'}</tbody></table>
    </section>
  </div>

  <section class="panel">
    <h2>Quality Gate &amp; Build/Test Reports</h2>
    <table><thead><tr><th>Time</th><th>Verdict</th><th>Pass Rate</th><th>Revision</th><th>Check Breakdown</th></tr></thead>
    <tbody>${gateRows || '<tr><td colspan="5">No quality gate runs recorded yet.</td></tr>'}</tbody></table>
  </section>

  <div class="grid">
    <section class="panel">
      <h2>Security Findings</h2>
      <table><thead><tr><th>Severity</th><th>Category</th><th>Location</th><th>Summary</th><th>Status</th></tr></thead>
      <tbody>${secRows || '<tr><td colspan="5">No open security findings recorded.</td></tr>'}</tbody></table>
    </section>
    <section class="panel">
      <h2>Code Review Findings</h2>
      <table><thead><tr><th>Reviewer</th><th>Severity</th><th>Summary</th><th>Status</th></tr></thead>
      <tbody>${revRows || '<tr><td colspan="4">No review findings recorded yet.</td></tr>'}</tbody></table>
    </section>
  </div>

  <div class="grid">
    <section class="panel">
      <h2>Release Candidates &amp; History</h2>
      <table><thead><tr><th>Version</th><th>Status</th><th>Revision</th><th>Approved By</th><th>Notes</th></tr></thead>
      <tbody>${relRows || '<tr><td colspan="5">No release candidates prepared yet.</td></tr>'}</tbody></table>
    </section>
    <section class="panel">
      <h2>Factory Health &amp; Provider Matrix</h2>
      <div class="pad">${runtimeBadges}</div>
      <table><thead><tr><th>Provider</th><th>Installed</th><th>Auth</th><th>Notes</th></tr></thead>
      <tbody>${providerRows}</tbody></table>
    </section>
  </div>

  <div class="grid">
    <section class="panel">
      <h2>Execution Logs (Redacted)</h2>
      <div class="logs-box">${logRows || '<div class="log-line">No execution logs yet.</div>'}</div>
    </section>
    <section class="panel">
      <h2>Project Configuration &amp; Profile (${htmlEscape(snapshot.activeProfile?.profile_id || 'auto')})</h2>
      <pre>${htmlEscape(activeProject ? JSON.stringify(activeProject.config, null, 2) : '{}')}</pre>
    </section>
  </div>

  <div class="grid">
    <section class="panel">
      <h2>Specialist Routing Decisions (${htmlEscape(String((snapshot.specialists || []).length))} Agents Available)</h2>
      <table><thead><tr><th>Primary / Support</th><th>Mode</th><th>Skills</th><th>Request</th></tr></thead>
      <tbody>${routingRows || '<tr><td colspan="4">No routing decisions recorded yet.</td></tr>'}</tbody></table>
    </section>
    <section class="panel">
      <h2>Skills Registry &amp; Suggestions</h2>
      <div class="pad">${suggestedBadges || '<span class="tag">Run factory skills recommend .</span>'}</div>
      <table><thead><tr><th>Skill</th><th>Approval</th><th>SHA-256</th><th>Audit</th></tr></thead>
      <tbody>${skillRows || '<tr><td colspan="4">No installed registry records yet.</td></tr>'}</tbody></table>
    </section>
  </div>

  <div class="grid">
    <section class="panel">
      <h2>Project &amp; Global Memory</h2>
      <table><thead><tr><th>Scope / Source</th><th>Category</th><th>Statement</th></tr></thead>
      <tbody>${memRows || '<tr><td colspan="3">No memories persisted yet.</td></tr>'}</tbody></table>
    </section>
    <section class="panel">
      <h2>Pending Candidate Lessons &amp; Improvement Proposals</h2>
      <table><thead><tr><th>Candidate ID</th><th>Category</th><th>Statement</th></tr></thead>
      <tbody>${candidateRows || '<tr><td colspan="3">No pending candidates awaiting approval.</td></tr>'}</tbody></table>
      <table><thead><tr><th>Improvement Proposal</th><th>Status</th></tr></thead>
      <tbody>${proposalRows || '<tr><td colspan="2">No improvement proposals generated yet.</td></tr>'}</tbody></table>
    </section>
  </div>

  <div class="grid">
    <section class="panel">
      <h2>Context Budget &amp; Token Telemetry</h2>
      <table><thead><tr><th>Mode</th><th>Context vs Baseline</th><th>Tokens</th><th>Agents</th></tr></thead>
      <tbody>${metricRows || '<tr><td colspan="4">No context metrics recorded yet.</td></tr>'}</tbody></table>
    </section>
    <section class="panel">
      <h2>Deployment Advisor &amp; Update History (Schema v${htmlEscape(String(snapshot.schema_version || 2))})</h2>
      <table><thead><tr><th>Platform</th><th>Profile</th><th>Evaluated Options</th><th>Time</th></tr></thead>
      <tbody>${deployRows || '<tr><td colspan="4">Run factory deploy advise . to evaluate hosting.</td></tr>'}</tbody></table>
      <table><thead><tr><th>Action</th><th>Versions</th><th>Status</th><th>Time</th></tr></thead>
      <tbody>${updateRows || '<tr><td colspan="4">No factory updates recorded yet.</td></tr>'}</tbody></table>
    </section>
  </div>

  <footer>Persisted in SQLite (${htmlEscape(snapshot.db_path)}). Read-only HTTP APIs: <code>/api/overview</code>, <code>/api/projects</code>, <code>/api/health</code>, <code>/api/agents</code>, <code>/api/skills</code>, <code>/api/memory</code>, <code>/api/updates</code>, <code>/api/metrics</code>. Automatic deployment is disabled; approvals require clean verified HEAD.</footer>
</main>
</body>
</html>`;
}

export function startDashboardServer({ dbPath = null, globalDbPath = null, openDbFn = null, db = null, projectPath = null, port = 4177, version = '1.0.0' }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be 1–65535');
  }

  const server = createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Connection': 'close' });
      return res.end('Method not allowed');
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const selectedId = url.searchParams.get('project');
    const targetProject = selectedId || projectPath;

    let snapshot;
    if (openDbFn && dbPath) {
      const reqDb = openDbFn(dbPath);
      const reqGlobalDb = globalDbPath && existsSync(globalDbPath) ? openDbFn(globalDbPath) : null;
      try {
        snapshot = buildDashboardSnapshot({ db: reqDb, globalDb: reqGlobalDb, activeProjectPath: targetProject, version });
      } finally {
        if (reqGlobalDb) reqGlobalDb.close();
        reqDb.close();
      }
    } else {
      snapshot = buildDashboardSnapshot({ db, activeProjectPath: targetProject, version });
    }

    const commonHeaders = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Connection': 'close'
    };

    const jsonReply = data => {
      res.writeHead(200, { ...commonHeaders, 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(data, null, 2));
    };

    if (url.pathname === '/api/overview') return jsonReply(snapshot);
    if (url.pathname === '/api/projects') return jsonReply(snapshot.projects);
    if (url.pathname === '/api/health') return jsonReply(snapshot.health);
    if (url.pathname === '/api/agents') return jsonReply({ total: snapshot.specialists.length, categories: snapshot.specialistCategories, specialists: snapshot.specialists, routingDecisions: snapshot.routingDecisions });
    if (url.pathname === '/api/skills') return jsonReply({ installed: snapshot.skillRegistry, suggested: snapshot.suggestedSkills });
    if (url.pathname === '/api/memory') return jsonReply({ project: snapshot.projectMemories, global: snapshot.globalMemories, candidates: snapshot.candidateMemories, approvedPreferences: snapshot.approvedPreferences });
    if (url.pathname === '/api/updates') return jsonReply({ version: snapshot.version, schema_version: snapshot.schema_version, updateHistory: snapshot.updateHistory });
    if (url.pathname === '/api/metrics') return jsonReply({ contextMetrics: snapshot.contextMetrics, improvementProposals: snapshot.improvementProposals, deploymentAdvice: snapshot.deploymentAdvice });
    if (url.pathname !== '/') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Connection': 'close' });
      return res.end('Not found');
    }

    res.writeHead(200, {
      ...commonHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
    });
    return res.end(renderDashboardHtml(snapshot, version));
  });

  const origClose = server.close.bind(server);
  server.close = function (cb) {
    if (db) {
      try { db.close(); } catch {}
    }
    const ret = origClose(cb);
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    return ret;
  };

  server.listen(port, '127.0.0.1');
  return server;
}
