import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { inspectProjectStack } from './adapters.mjs';
import { scanSecrets, redactSecrets, safeSpawn } from './security.mjs';

export const PIPELINE_STAGES = [
  'requirements',
  'planning',
  'architecture',
  'assignment',
  'implementation',
  'integration',
  'testing',
  'security_review',
  'quality_review',
  'release_candidate',
  'human_approval',
  'deployment',
  'verification'
];

export const AGENT_ROLES = {
  director: {
    id: 'director',
    name: 'Factory Director Agent',
    stage: 'assignment',
    description: 'Decomposes requirements, manages lifecycle stages, schedules DAG tasks, and tracks blockers.'
  },
  product_manager: {
    id: 'product_manager',
    name: 'Product Manager Agent',
    stage: 'requirements',
    description: 'Converts requirements into user stories, measurable acceptance criteria, and PRDs.'
  },
  architect: {
    id: 'architect',
    name: 'Architecture Agent',
    stage: 'architecture',
    description: 'Selects architecture, stack boundaries, API contracts, and minimal complexity design.'
  },
  ui_ux: {
    id: 'ui_ux',
    name: 'UI/UX Agent',
    stage: 'architecture',
    description: 'Designs accessible, responsive interfaces, state feedback, and reusable design tokens.'
  },
  frontend: {
    id: 'frontend',
    name: 'Frontend Agent',
    stage: 'implementation',
    description: 'Implements web interfaces, client validation, accessibility attributes, and UI tests.'
  },
  backend: {
    id: 'backend',
    name: 'Backend Agent',
    stage: 'implementation',
    description: 'Implements APIs, authentication, authorization, business logic, and integrations.'
  },
  database: {
    id: 'database',
    name: 'Database Agent',
    stage: 'implementation',
    description: 'Creates schemas, migrations, constraints, indexes, and database integrity tests.'
  },
  mobile: {
    id: 'mobile',
    name: 'Mobile Agent',
    stage: 'implementation',
    description: 'Develops Android and iOS mobile features using Flutter or Expo/React Native.'
  },
  ai_ml: {
    id: 'ai_ml',
    name: 'AI/ML Agent',
    stage: 'implementation',
    description: 'Implements AI inference services, prompt boundaries, evaluations, and model fallbacks.'
  },
  security: {
    id: 'security',
    name: 'Security Agent',
    stage: 'security_review',
    description: 'Audits access control, secrets, untrusted inputs, and dependency vulnerabilities.'
  },
  qa: {
    id: 'qa',
    name: 'QA Agent',
    stage: 'testing',
    description: 'Executes unit, integration, E2E, accessibility, and regression quality gates.'
  },
  code_review: {
    id: 'code_review',
    name: 'Code Review Agent',
    stage: 'quality_review',
    description: 'Independently reviews diffs, whitespace/hygiene, complexity, and acceptance coverage.'
  },
  devops: {
    id: 'devops',
    name: 'DevOps Agent',
    stage: 'release_candidate',
    description: 'Prepares reproducible builds, health checks, env templates, and rollback runbooks.'
  },
  documentation: {
    id: 'documentation',
    name: 'Documentation Agent',
    stage: 'verification',
    description: 'Maintains architecture records, setup guides, changelogs, and operational runbooks.'
  }
};

function probeCli(cmd) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'which';
  return spawnSync(probe, [cmd], { stdio: 'ignore' }).status === 0;
}

/** Report truthful provider availability without revealing any credential values. */
export function detectProviders() {
  return [
    {
      id: 'local-deterministic',
      label: 'Local Deterministic Factory Engine',
      available: true,
      authenticated: true,
      notes: 'Executes planning, stack inspection, git worktrees, tests, secret scans, diff review, and release gates.'
    },
    {
      id: 'antigravity-ide',
      label: 'Google Antigravity IDE Native Agent',
      available: true,
      authenticated: true,
      notes: 'Operated inside Antigravity via /factory-* skills, workflows, and IDE subagents.'
    },
    {
      id: 'claude-cli',
      label: 'Claude Code CLI',
      available: probeCli('claude'),
      authenticated: Boolean(process.env.ANTHROPIC_API_KEY),
      notes: probeCli('claude') ? (process.env.ANTHROPIC_API_KEY ? 'CLI present and API key env set' : 'CLI present; ANTHROPIC_API_KEY not set in env') : 'CLI not installed'
    },
    {
      id: 'codex-cli',
      label: 'OpenAI Codex CLI',
      available: probeCli('codex'),
      authenticated: Boolean(process.env.OPENAI_API_KEY),
      notes: probeCli('codex') ? (process.env.OPENAI_API_KEY ? 'CLI present and API key env set' : 'CLI present; OPENAI_API_KEY not set in env') : 'CLI not installed'
    },
    {
      id: 'gemini-cli',
      label: 'Gemini CLI',
      available: probeCli('gemini'),
      authenticated: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      notes: probeCli('gemini') ? ((process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) ? 'CLI present and API key env set' : 'CLI present; GEMINI_API_KEY not set in env') : 'CLI not installed'
    }
  ];
}

function writeDoc(projectPath, relPath, content) {
  const full = join(projectPath, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return relPath;
}

function tryGitDiffCheck(cwd) {
  if (!existsSync(join(cwd, '.git'))) return { available: false, ok: true, detail: 'Not a Git repo; diff hygiene skipped' };
  const res = safeSpawn('git', ['diff', '--check'], { cwd });
  return { available: true, ok: res.ok, detail: res.ok ? 'git diff --check clean' : (res.stdout || res.stderr || 'Whitespace/conflict markers detected') };
}

function tryDependencyAudit(cwd) {
  if (existsSync(join(cwd, 'package-lock.json')) && existsSync(join(cwd, 'package.json'))) {
    const res = safeSpawn('npm', ['audit', '--omit=dev', '--json'], { cwd, timeout: 60000 });
    try {
      const parsed = JSON.parse(res.stdout || '{}');
      const vulns = parsed.metadata?.vulnerabilities || {};
      const critical = vulns.critical || 0;
      const high = vulns.high || 0;
      return {
        verified: true,
        ok: critical === 0 && high === 0,
        critical,
        high,
        summary: `npm audit: critical=${critical}, high=${high}, moderate=${vulns.moderate || 0}`
      };
    } catch {
      return { verified: false, ok: false, summary: `npm audit could not parse output (exit=${res.status})` };
    }
  }
  return { verified: false, ok: true, summary: 'NOT VERIFIED: No supported lockfile audit runner executed' };
}

/**
 * Execute an agent task deterministically in the target workspace/worktree.
 * Never fabricates LLM outputs: implementation tasks either execute a real
 * configured worker script or pause cleanly as `awaiting_agent` for Antigravity IDE.
 */
export async function executeAgentTask({ db, project, task, runGateFn }) {
  const workDir = task.worktree && existsSync(task.worktree) ? task.worktree : project.path;
  const role = AGENT_ROLES[task.agent_role] || AGENT_ROLES.backend;
  const runId = db.startAgentRun(project.id, {
    pipelineId: task.pipeline_id,
    taskId: task.id,
    agentRole: role.id,
    provider: 'local-deterministic'
  });

  db.log(project.id, `[${role.name}] Starting task ${task.id}: ${task.title}`, {
    pipelineId: task.pipeline_id,
    taskId: task.id,
    agentRole: role.id
  });

  try {
    const stack = inspectProjectStack(workDir);
    let outcome = { status: 'completed', summary: '', artifacts: [], handoffRequired: false };

    if (role.id === 'product_manager') {
      const file = writeDoc(workDir, 'docs/factory/PRD.md', [
        `# Product Requirements Document`,
        ``,
        `- **Project:** ${project.name}`,
        `- **Task ID:** ${task.id}`,
        `- **Goal:** ${task.title}`,
        `- **Generated:** ${new Date().toISOString()}`,
        ``,
        `## Acceptance Criteria`,
        `${task.criteria || 'Define measurable acceptance criteria before shipping.'}`,
        ``,
        `## Non-Functional & Quality Targets`,
        `- Automated tests pass with 0 unresolved failures on target HEAD.`,
        `- 0 unresolved critical/high security findings or tracked secrets.`,
        `- Explicit human approval required before merge, push, or deployment.`,
        ``
      ].join('\n'));
      outcome = { status: 'completed', summary: `Generated ${file}`, artifacts: [file] };
    } else if (role.id === 'architect') {
      const file = writeDoc(workDir, 'docs/factory/ARCHITECTURE.md', [
        `# System Architecture`,
        ``,
        `- **Detected Adapters:** ${stack.adapters.join(', ') || 'none'}`,
        `- **Configured Quality Gates:** ${stack.required_checks.map(c => c.name).join(', ') || 'none'}`,
        `- **Execution Boundary:** Isolated Git worktree per independent implementation task.`,
        `- **Design Principles:** pstack foundational boundaries + Ponytail minimal dependencies.`,
        ``,
        `## Scope & Contracts`,
        `${task.criteria}`,
        ``
      ].join('\n'));
      outcome = { status: 'completed', summary: `Recorded architecture in ${file}`, artifacts: [file] };
    } else if (role.id === 'ui_ux') {
      const file = writeDoc(workDir, 'docs/factory/UI_UX_SPEC.md', [
        `# UI/UX & Accessibility Specification`,
        ``,
        `- **Target:** WCAG 2.2 AA contrast, semantic landmarks, keyboard navigation, responsive layout.`,
        `- **Required UI States:** loading, empty, error (actionable), and success confirmation.`,
        `- **Scope:** ${task.criteria}`,
        ``
      ].join('\n'));
      outcome = { status: 'completed', summary: `Recorded UI/UX specification in ${file}`, artifacts: [file] };
    } else if (role.id === 'security') {
      const sec = scanSecrets(workDir);
      const audit = tryDependencyAudit(workDir);
      const allFindings = [...sec.findings];
      if (audit.verified && !audit.ok) {
        allFindings.push({
          severity: audit.critical > 0 ? 'critical' : 'high',
          category: 'dependency-vulnerability',
          file: 'package-lock.json',
          line: 0,
          summary: audit.summary
        });
      }
      db.replaceOpenSecurityFindings(project.id, task.id, allFindings);
      const criticalOrHigh = allFindings.filter(f => f.severity === 'critical' || f.severity === 'high');
      if (criticalOrHigh.length > 0) {
        outcome = {
          status: 'blocked',
          summary: `Security gate BLOCKED: ${criticalOrHigh.length} critical/high finding(s). ${audit.summary}`,
          artifacts: []
        };
      } else {
        outcome = {
          status: 'completed',
          summary: `Security scan passed (${sec.filesScanned} files scanned, 0 critical/high findings). ${audit.summary}`,
          artifacts: []
        };
      }
    } else if (role.id === 'qa') {
      const report = runGateFn(project.path, task.id);
      outcome = {
        status: report.ok ? 'completed' : 'blocked',
        summary: report.ok
          ? `All ${report.results.length} QA/quality gates PASSED at revision ${report.revision || 'uncommitted'}.`
          : `QA gates BLOCKED: ${report.results.filter(r => !r.ok).map(r => r.name).join(', ')}`,
        artifacts: [report.reportPath].filter(Boolean)
      };
    } else if (role.id === 'code_review') {
      const diffCheck = tryGitDiffCheck(workDir);
      const sec = scanSecrets(workDir);
      let changedFiles = [];
      if (existsSync(join(workDir, '.git'))) {
        try {
          changedFiles = execFileSync('git', ['status', '--porcelain'], { cwd: workDir, encoding: 'utf8' })
            .split(/\r?\n/).filter(Boolean);
        } catch {
          // ignore
        }
      }
      if (!diffCheck.ok) {
        db.addReviewFinding(project.id, {
          taskId: task.id,
          reviewerRole: 'code_review',
          severity: 'medium',
          summary: diffCheck.detail
        });
        outcome = { status: 'blocked', summary: `Code review blocked: ${diffCheck.detail}`, artifacts: [] };
      } else if (!sec.ok) {
        outcome = { status: 'blocked', summary: `Code review blocked by ${sec.findings.length} secret finding(s).`, artifacts: [] };
      } else {
        db.addReviewFinding(project.id, {
          taskId: task.id,
          reviewerRole: 'code_review',
          severity: 'info',
          summary: `Diff hygiene clean (${changedFiles.length} uncommitted path(s)); Ponytail/pstack review recorded.`,
          status: 'resolved'
        });
        outcome = {
          status: 'completed',
          summary: `Code review passed (${diffCheck.detail}).`,
          artifacts: []
        };
      }
    } else if (role.id === 'devops') {
      const file = writeDoc(workDir, 'docs/factory/RUNBOOK.md', [
        `# Release & Rollback Runbook`,
        ``,
        `- **Project:** ${project.name}`,
        `- **Configured Build/Test Gates:** ${stack.required_checks.map(c => `${c.name}: \`${c.command} ${c.args.join(' ')}\``).join('; ') || 'None configured'}`,
        `- **Deployment Policy:** Manual human approval required (\`automatic_deployment: false\`).`,
        `- **Rollback Procedure:** Revert release tag/commit (\`git revert <commit>\`), restore prior artifact, re-run \`factory verify\`.`,
        ``
      ].join('\n'));
      outcome = { status: 'completed', summary: `Updated ${file}`, artifacts: [file] };
    } else if (role.id === 'documentation') {
      const file = writeDoc(workDir, 'docs/factory/STATUS.md', [
        `# Factory Execution Status`,
        ``,
        `- **Project:** ${project.name}`,
        `- **Updated:** ${new Date().toISOString()}`,
        `- **Adapters:** ${stack.adapters.join(', ') || 'generic'}`,
        `- **Last Task:** ${task.id} (${task.title})`,
        ``
      ].join('\n'));
      outcome = { status: 'completed', summary: `Synchronized ${file}`, artifacts: [file] };
    } else {
      // Implementation roles: director, frontend, backend, database, mobile, ai_ml
      // Check if an explicit trusted local worker script exists in .factory/workers/<task_id>.mjs or <role>.mjs
      const taskWorker = join(project.path, '.factory', 'workers', `${task.id}.mjs`);
      const roleWorker = join(project.path, '.factory', 'workers', `${role.id}.mjs`);
      const workerFile = existsSync(taskWorker) ? taskWorker : (existsSync(roleWorker) ? roleWorker : null);

      if (workerFile) {
        const res = safeSpawn(process.execPath, [workerFile, workDir, task.id], { cwd: workDir, timeout: 180000 });
        outcome = {
          status: res.ok ? 'completed' : 'failed',
          summary: res.ok ? (res.stdout.trim() || `Executed worker ${workerFile}`) : (res.stderr || res.stdout || res.error || 'Worker failed'),
          artifacts: []
        };
      } else {
        // No silent fake coding: mark awaiting_agent so Antigravity IDE (/factory-build) executes it cleanly.
        const briefPath = join(project.path, '.factory', 'tasks', `${task.id}.md`);
        const prompt = [
          `# Antigravity Task Brief: ${task.title}`,
          ``,
          `- **Task ID:** ${task.id}`,
          `- **Role:** ${role.name}`,
          `- **Worktree:** ${workDir}`,
          `- **Acceptance Criteria:** ${task.criteria}`,
          ``,
          `Run inside Antigravity with \`/factory-build\`, \`/poteto-mode\`, and \`/ponytail full\`.`,
          `After editing & committing inside \`${workDir}\`, verify with:`,
          `\`node "${resolve(import.meta.dirname, '..', 'bin', 'factory.mjs')}" verify "${project.path}" --id "${task.id}"\``
        ].join('\n');
        mkdirSync(join(briefPath, '..'), { recursive: true });
        writeFileSync(briefPath, prompt, 'utf8');
        outcome = {
          status: 'awaiting_agent',
          handoffRequired: true,
          summary: `Prepared Antigravity IDE brief at .factory/tasks/${task.id}.md (awaiting IDE agent or worker implementation).`,
          artifacts: [`.factory/tasks/${task.id}.md`]
        };
      }
    }

    db.finishAgentRun(runId, {
      status: outcome.status,
      outputSummary: redactSecrets(outcome.summary),
      error: outcome.status === 'failed' || outcome.status === 'blocked' ? redactSecrets(outcome.summary) : null
    });
    db.log(project.id, `[${role.name}] ${outcome.summary}`, {
      pipelineId: task.pipeline_id,
      taskId: task.id,
      agentRole: role.id,
      level: outcome.status === 'blocked' || outcome.status === 'failed' ? 'warn' : 'info'
    });
    return outcome;
  } catch (err) {
    const msg = redactSecrets(err?.message || String(err));
    db.finishAgentRun(runId, { status: 'failed', error: msg });
    db.log(project.id, `[${role.name}] Error: ${msg}`, {
      pipelineId: task.pipeline_id,
      taskId: task.id,
      agentRole: role.id,
      level: 'error'
    });
    return { status: 'failed', summary: msg, artifacts: [] };
  }
}

