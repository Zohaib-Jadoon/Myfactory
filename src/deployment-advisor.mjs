import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inspectProjectStack } from './adapters.mjs';
import { detectProjectProfile } from './profiles.mjs';
import { retrieveRelevantMemories } from './memory.mjs';

export const DEPLOYMENT_PLATFORMS = {
  vercel: {
    id: 'vercel',
    label: 'Vercel',
    ideal_for: ['nextjs', 'react'],
    cost_tier: 'free-to-pro',
    ops_complexity: 'low',
    rollback_simplicity: 'instant-deployment-promote',
    notes: 'Ideal for Next.js frontend/SSR when long-lived stateful WebSockets are not required on the same host.'
  },
  render: {
    id: 'render',
    label: 'Render',
    ideal_for: ['nestjs', 'node', 'python', 'postgres', 'iot'],
    cost_tier: 'starter-low',
    ops_complexity: 'low',
    rollback_simplicity: 'one-click-rollback',
    notes: 'Supports managed Postgres, persistent WebSockets, cron/background workers, and Dockerfiles with minimal ops overhead.'
  },
  koyeb: {
    id: 'koyeb',
    label: 'Koyeb',
    ideal_for: ['docker', 'nestjs', 'node', 'python'],
    cost_tier: 'starter-low',
    ops_complexity: 'low',
    rollback_simplicity: 'revision-redeploy',
    notes: 'Lightweight global container deployment with Git/Docker integration and low idle cost.'
  },
  'github-actions': {
    id: 'github-actions',
    label: 'GitHub Actions CI/CD',
    ideal_for: ['node', 'nextjs', 'nestjs', 'python', 'dotnet', 'expo', 'flutter', 'desktop'],
    cost_tier: 'free-standard',
    ops_complexity: 'low',
    rollback_simplicity: 'git-revert-tag',
    notes: 'Automates pre-release test, lint, secret scan, and signed-off artifact generation.'
  },
  'windows-iis': {
    id: 'windows-iis',
    label: 'Windows IIS',
    ideal_for: ['iis_asp', 'dotnet', 'sqlserver', 'legacy'],
    cost_tier: 'existing-onprem-or-vps',
    ops_complexity: 'medium',
    rollback_simplicity: 'backup-directory-swap',
    notes: 'Required/preferred for Classic ASP, ASP.NET, web.config bindings, and internal SQL Server LAN integration.'
  },
  docker: {
    id: 'docker',
    label: 'Docker Container',
    ideal_for: ['docker', 'nestjs', 'python', 'iot', 'ai_ml'],
    cost_tier: 'portable',
    ops_complexity: 'medium',
    rollback_simplicity: 'image-tag-revert',
    notes: 'Portable immutable artifact for reproducible staging and VPS/Render/Koyeb rollout.'
  },
  'windows-server': {
    id: 'windows-server',
    label: 'Self-Hosted Windows Server',
    ideal_for: ['iis_asp', 'sqlserver', 'dotnet', 'desktop'],
    cost_tier: 'existing-infra',
    ops_complexity: 'medium',
    rollback_simplicity: 'zip-restore-and-service-restart',
    notes: 'Suited for on-premise Windows Services, local fingerprint/hardware hubs, or internal ERP deployments.'
  },
  'linux-vps': {
    id: 'linux-vps',
    label: 'Linux VPS (systemd + reverse proxy)',
    ideal_for: ['docker', 'iot', 'ai_ml', 'postgres'],
    cost_tier: 'predictable-flat',
    ops_complexity: 'medium',
    rollback_simplicity: 'symlink-release-switch',
    notes: 'Cost-predictable hosting for TCP/MQTT fleet trackers, long-running inference services, and WebSockets.'
  },
  'expo-eas-apk': {
    id: 'expo-eas-apk',
    label: 'Expo EAS / Flutter APK & Store Pipeline',
    ideal_for: ['expo', 'flutter', 'mobile'],
    cost_tier: 'free-to-build-tier',
    ops_complexity: 'low-medium',
    rollback_simplicity: 'ota-or-version-bump',
    notes: 'Distinguishes debug/internal APK verification builds from human-approved signed Play Store / App Store releases.'
  },
  'electron-installer': {
    id: 'electron-installer',
    label: 'Desktop Installer Packaging (NSIS/MSI/Tauri)',
    ideal_for: ['desktop'],
    cost_tier: 'github-releases',
    ops_complexity: 'medium',
    rollback_simplicity: 'pinned-installer-release',
    notes: 'Requires packaged binary startup verification, not just dev server launch.'
  },
  'game-export': {
    id: 'game-export',
    label: 'Game Engine Platform Export (Unity / Unreal / Godot)',
    ideal_for: ['unity', 'unreal', 'godot', 'game'],
    cost_tier: 'platform-dependent',
    ops_complexity: 'medium',
    rollback_simplicity: 'build-manifest-tag',
    notes: 'Uses engine export presets with frame-budget and save-compatibility verification prior to store upload.'
  }
};

function detectExistingConfigs(projectPath) {
  const root = resolve(projectPath);
  const detected = [];
  if (existsSync(join(root, 'vercel.json'))) detected.push({ platform: 'vercel', file: 'vercel.json' });
  if (existsSync(join(root, 'render.yaml'))) detected.push({ platform: 'render', file: 'render.yaml' });
  if (existsSync(join(root, 'koyeb.yaml'))) detected.push({ platform: 'koyeb', file: 'koyeb.yaml' });
  if (existsSync(join(root, 'Dockerfile')) || existsSync(join(root, 'docker-compose.yml'))) detected.push({ platform: 'docker', file: 'Dockerfile' });
  if (existsSync(join(root, 'web.config'))) detected.push({ platform: 'windows-iis', file: 'web.config' });
  if (existsSync(join(root, 'eas.json'))) detected.push({ platform: 'expo-eas-apk', file: 'eas.json' });
  if (existsSync(join(root, '.github', 'workflows'))) {
    const wfs = readdirSync(join(root, '.github', 'workflows')).filter(f => /\.ya?ml$/i.test(f));
    if (wfs.length) detected.push({ platform: 'github-actions', file: `.github/workflows/${wfs[0]}` });
  }
  const pkgFile = join(root, 'package.json');
  if (existsSync(pkgFile)) {
    try {
      const txt = readFileSync(pkgFile, 'utf8');
      if (txt.includes('electron-builder')) detected.push({ platform: 'electron-installer', file: 'package.json#electron-builder' });
    } catch {
      // ignore
    }
  }
  return detected;
}

/** Evaluate practical deployment platforms using existing infra, stack fit, simplicity, and past lessons. */
export function adviseDeployment({ projectPath = '.', projectDb = null, globalDb = null } = {}) {
  const root = resolve(projectPath);
  const stack = inspectProjectStack(root, { includeRuntimes: false });
  const detectedProfile = detectProjectProfile(root, stack);
  const projRec = projectDb ? projectDb.getProject(root) : null;
  const profileId = (projRec && projectDb?.getProjectProfile(projRec.id)?.profile_id) || detectedProfile.profileId;
  const existingConfigs = detectExistingConfigs(root);

  const memResult = (projectDb || globalDb)
    ? retrieveRelevantMemories({
        projectDb,
        globalDb,
        projectId: projRec?.id || null,
        profileId,
        stack: stack.adapters,
        query: 'deploy deployment hosting iis docker vercel render rollback',
        limit: 8
      })
    : { items: [] };
  const deploymentLessons = memResult.items.filter(m =>
    m.category === 'deployment' || /\b(iis|deploy|vercel|render|docker|apk|installer|rollback|web\.config)\b/i.test(m.statement)
  );

  const existingSet = new Set(existingConfigs.map(c => c.platform));
  const scored = Object.values(DEPLOYMENT_PLATFORMS).map(plat => {
    let score = 0;
    const rationale = [];

    if (existingSet.has(plat.id)) {
      score += 50;
      rationale.push('Preserves existing working deployment configuration');
    }
    for (const ad of stack.adapters) {
      if (plat.ideal_for.includes(ad)) {
        score += 18;
        rationale.push(`Matches stack adapter: ${ad}`);
      }
    }
    if (plat.ideal_for.includes(profileId)) {
      score += 15;
      rationale.push(`Aligned with profile: ${profileId}`);
    }
    if (plat.ops_complexity === 'low') {
      score += 8;
      rationale.push('Minimal operational complexity');
    }
    if (plat.id === 'windows-iis' && (stack.adapters.includes('iis_asp') || profileId === 'legacy')) {
      score += 35;
    }
    if (plat.id === 'game-export' && profileId === 'game') {
      score += 45;
    }
    if (plat.id === 'electron-installer' && (stack.adapters.includes('desktop') || profileId === 'desktop')) {
      score += 40;
    }
    if (plat.id === 'expo-eas-apk' && (stack.adapters.includes('expo') || stack.adapters.includes('flutter') || profileId === 'mobile')) {
      score += 40;
    }

    return {
      platform: plat.id,
      label: plat.label,
      score,
      cost_tier: plat.cost_tier,
      ops_complexity: plat.ops_complexity,
      rollback_simplicity: plat.rollback_simplicity,
      rationale: [...new Set(rationale)],
      notes: plat.notes
    };
  }).sort((a, b) => b.score - a.score);

  const options = scored.filter(o => o.score > 10).slice(0, 4);
  if (options.length === 0) options.push(scored[0]);
  const recommended = options[0];

  const advice = {
    project: root,
    profile_id: profileId,
    adapters: stack.adapters,
    existing_configs: existingConfigs,
    recommended_platform: recommended.platform,
    recommended_label: recommended.label,
    evaluated_criteria: [
      'existing_infrastructure', 'stack_compatibility', 'financial_cost', 'engineering_effort',
      'operational_complexity', 'repeatability', 'security', 'performance',
      'rollback_simplicity', 'maintenance_burden', 'vendor_restrictions', 'expected_scale'
    ],
    anti_overengineering_note: 'Selected simplest compatible option; Kubernetes/microservices omitted unless measured workload demands it.',
    options,
    relevant_lessons: deploymentLessons.map(m => ({ id: m.id, statement: m.statement, source_type: m.source_type, evidence: m.evidence_ref })),
    manual_approval_required: true
  };

  if (projectDb && projRec) {
    projectDb.recordDeploymentAdvice({
      project_id: projRec.id,
      profile_id: profileId,
      recommended_platform: recommended.platform,
      options,
      plan_markdown: null
    });
  }

  return advice;
}

/** Generate a concrete, platform-specific pre-flight, build, verification, and rollback deployment plan. */
export function generateDeploymentPlan({ projectPath = '.', projectDb = null, globalDb = null, target = null } = {}) {
  const advice = adviseDeployment({ projectPath, projectDb, globalDb });
  const chosenId = target && DEPLOYMENT_PLATFORMS[target] ? target : advice.recommended_platform;
  const plat = DEPLOYMENT_PLATFORMS[chosenId] || DEPLOYMENT_PLATFORMS.docker;

  const platformSteps = [];
  if (chosenId === 'windows-iis') {
    platformSteps.push(
      'Back up current IIS site directory and `web.config` to a timestamped archive BEFORE copying new artifacts.',
      'Validate SQL Server backups and idempotent T-SQL migrations cleanly in a staging database first.',
      'Stage release files with PowerShell; never stop/recycle unrelated IIS pools or restart Antigravity/Cursor IDE.',
      'Verify HTTP `/health` and legacy `.asp`/`.NET` routes after swap; retain previous archive for instant folder restore rollback.'
    );
  } else if (chosenId === 'expo-eas-apk') {
    platformSteps.push(
      'Build internal verification APK cleanly (`eas build --platform android --profile preview` or `flutter build apk --debug`).',
      'Test permissions (camera, GPS, notifications) and offline sync cleanly; mark emulator vs physical hardware verification accurately.',
      'Require explicit human approval before producing signed release AAB/APK or submitting to stores.'
    );
  } else if (chosenId === 'electron-installer') {
    platformSteps.push(
      'Build unpacked/installer desktop package (`npm run build` / `electron-builder`) and verify cold packaged `.exe` startup cleanly.',
      'Verify SQLite/appData migration & IPC security settings on packaged build (dev-mode run alone is NOT VERIFIED).'
    );
  } else if (chosenId === 'game-export') {
    platformSteps.push(
      'Run engine test runner and frame-budget/determinism verification prior to export.',
      'Execute headless platform export preset and verify packaged executable launch cleanly before store upload approval.'
    );
  } else {
    platformSteps.push(
      `Confirm env var names in \`.env.example\` are provisioned in ${plat.label} dashboard/secrets (no live values committed).`,
      'Run build + automated test + secret scan gates via `factory verify "."` on a clean Git HEAD.',
      'Verify database backup & `migrate deploy` order before switching traffic.',
      'Verify HTTP `/health` check returns 200 after deploy; retain rollback trigger.'
    );
  }

  const lessonLines = advice.relevant_lessons.length
    ? advice.relevant_lessons.map(l => `- **[Learned Lesson]** ${l.statement} *(evidence: ${l.evidence || 'verified'})*`)
    : ['- No platform-specific past deployment failures matched in memory yet.'];

  const planMarkdown = [
    `# Deployment Plan — ${plat.label} (\`${chosenId}\`)`,
    ``,
    `- **Project:** \`${advice.project}\``,
    `- **Profile:** \`${advice.profile_id}\` | **Adapters:** ${advice.adapters.join(', ') || 'generic'}`,
    `- **Existing Infra Detected:** ${advice.existing_configs.map(c => `${c.platform} (${c.file})`).join(', ') || 'None (greenfield setup)'}`,
    `- **Rollback Mechanism:** ${plat.rollback_simplicity}`,
    `- **Deployment Policy:** Manual human approval REQUIRED (\`factory approve\`); zero automatic production deployment.`,
    ``,
    `## Relevant Verified Deployment Lessons`,
    ...lessonLines,
    ``,
    `## Execution & Verification Steps`,
    ...platformSteps.map((s, i) => `${i + 1}. ${s}`),
    ``,
    `## Rollback Procedure`,
    `1. Halt rollout on health check failure.`,
    `2. Execute ${plat.label} rollback (${plat.rollback_simplicity}) or \`git revert <commit>\` + re-stage prior verified artifact.`,
    `3. Record post-incident root cause via \`factory learn "." --from-feedback\`.`,
    ``
  ].join('\n');

  const projRec = projectDb ? projectDb.getProject(resolve(projectPath)) : null;
  if (projectDb && projRec) {
    projectDb.recordDeploymentAdvice({
      project_id: projRec.id,
      profile_id: advice.profile_id,
      recommended_platform: chosenId,
      options: advice.options,
      plan_markdown: planMarkdown
    });
  }

  return { ...advice, target: chosenId, plan_markdown: planMarkdown, steps: platformSteps };
}
