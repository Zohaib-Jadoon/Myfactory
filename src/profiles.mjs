import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const PROJECT_PROFILES = {
  web: {
    id: 'web',
    label: 'Profile A — SaaS / Web Applications',
    preferred_stack: [
      'Next.js 14-16', 'React 19', 'TypeScript', 'Tailwind CSS v4',
      'shadcn/ui', 'NestJS 11', 'PostgreSQL / Neon', 'Prisma', 'REST APIs', 'RBAC', 'Vercel / Render'
    ],
    primary_specialists: ['frontend-developer', 'backend-architect', 'prisma-specialist', 'postgres-neon-specialist', 'ui-designer'],
    recommended_skills: ['eng-frontend', 'eng-backend', 'eng-databases', 'eng-architecture'],
    priorities: [
      'Polished, uncluttered accessible dashboards with WCAG 2.2 AA contrast',
      'Validated REST DTO contracts and RBAC enforcement',
      'Maintainable modular architecture and production error/loading/empty states'
    ],
    guardrails: [
      'Respect existing framework choices before proposing rewrites',
      'Verify Prisma/SQL migrations safely with rollback scripts'
    ]
  },
  mobile: {
    id: 'mobile',
    label: 'Profile B — Mobile Applications',
    preferred_stack: [
      'Expo / React Native', 'Flutter', 'Android APK & Release Builds',
      'GPS / Location Services', 'Camera Permissions', 'OS Biometric Prompt', 'Notifications', 'Offline Queue'
    ],
    primary_specialists: ['mobile-app-builder', 'react-native-engineer', 'flutter-engineer', 'mobile-device-tester'],
    recommended_skills: ['eng-mobile', 'eng-quality', 'eng-backend'],
    priorities: [
      'Permission denial flows, offline synchronization, and actionable error recovery',
      'Distinguish simulated/emulator runs from verified real-device hardware tests',
      'Separate debug/release APK builds from Play Store signing & publishing'
    ],
    guardrails: [
      'Never mark emulator-only runs as real hardware device verification',
      'Never auto-build or publish signed production APKs without explicit approval'
    ]
  },
  ai: {
    id: 'ai',
    label: 'Profile C — AI & Biometric Systems',
    preferred_stack: [
      'Face Recognition & Verification', 'Liveness Detection', 'Anti-Spoofing Tests',
      'Model Evaluation (FAR/FRR)', 'Employee Enrollment', 'Device Registration', 'Location Evidence & Geofencing', 'External Fingerprint Readers'
    ],
    primary_specialists: ['ai-ml-engineer', 'biometric-ai-engineer', 'geospatial-engineer', 'security-reviewer'],
    recommended_skills: ['eng-ai-biometrics', 'eng-security', 'eng-quality'],
    priorities: [
      'Reproducible evaluation sets reporting FAR, FRR, and anti-spoofing failure modes',
      'Strict separation between OS-level biometric auth and external fingerprint/face identification',
      'Zero biometric embeddings, raw images, or PII persisted into shared factory memory'
    ],
    guardrails: [
      'Explicitly separate OS biometric unlock from external biometric template matching',
      'Privacy & consent boundaries before capturing face/location evidence'
    ]
  },
  iot: {
    id: 'iot',
    label: 'Profile D — IoT & Fleet Tracking',
    preferred_stack: [
      'GPS Tracker Protocols', 'Real-Time Telemetry', 'WebSockets / MQTT',
      'Vehicle Status & Ignition Events', 'Geofences', 'Historical Routes', 'OpenStreetMap', 'Device Authentication'
    ],
    primary_specialists: ['iot-telematics-engineer', 'geospatial-engineer', 'backend-architect', 'performance-engineer'],
    recommended_skills: ['eng-backend', 'eng-architecture', 'eng-deployment'],
    priorities: [
      'Authenticated device ingestion, idempotent telemetry packets, and clock-skew tolerance',
      'Low-latency WebSocket updates and indexed spatial/historical route queries'
    ],
    guardrails: [
      'Never represent simulated GPS/MQTT feeds as a live physical vehicle connection'
    ]
  },
  legacy: {
    id: 'legacy',
    label: 'Profile E — Windows & SQL Systems',
    preferred_stack: [
      'Microsoft SQL Server', 'T-SQL', 'Classic ASP', 'IIS',
      'PowerShell', 'Windows Services', 'Desktop Installers', 'Incremental Legacy Modernization'
    ],
    primary_specialists: ['windows-iis-engineer', 'legacy-asp-modernizer', 'sql-server-specialist', 'database-integrity-tester'],
    recommended_skills: ['eng-databases', 'eng-deployment', 'eng-quality'],
    priorities: [
      'Preserve production schemas, stored procedures, and existing business behavior',
      'Reversible T-SQL migrations, web.config safety, and IIS deployment verification without IDE restarts'
    ],
    guardrails: [
      'Never drop columns/tables or run destructive production SQL migrations without backup + approval',
      'Never recycle unrelated live IIS pools unexpectedly during local development'
    ]
  },
  desktop: {
    id: 'desktop',
    label: 'Desktop Applications',
    preferred_stack: ['Electron', 'Tauri', 'Node.js / Rust IPC', 'Windows Installers (NSIS/MSI)', 'Auto-Update Safety'],
    primary_specialists: ['desktop-app-builder', 'electron-engineer', 'security-reviewer', 'release-verifier'],
    recommended_skills: ['eng-desktop', 'eng-quality', 'eng-deployment'],
    priorities: [
      'Context isolation, sandboxed renderer, strict IPC validation, and filesystem permission boundaries',
      'Verify packaged executable startup, not just dev-mode hot reload'
    ],
    guardrails: [
      'Treat dev-mode launch only as NOT VERIFIED for packaged installer readiness'
    ]
  },
  enterprise: {
    id: 'enterprise',
    label: 'Profile F — HR / ERP / Healthcare',
    preferred_stack: [
      'Multi-Tenant RBAC', 'PostgreSQL / SQL Server', 'Attendance & Shifts',
      'Payroll', 'Scheduling', 'Clinical Workflows', 'Financial Audit Logs', 'Role-Specific Dashboards'
    ],
    primary_specialists: ['domain-modeler', 'backend-architect', 'database-engineer', 'security-reviewer'],
    recommended_skills: ['eng-backend', 'eng-databases', 'eng-architecture'],
    priorities: [
      'Tenant isolation at every query boundary, immutable financial/clinical audit trails',
      'Role-scoped authorization and PII/PHI protection'
    ],
    guardrails: [
      'Never store employee, patient, or payroll records in factory memory'
    ]
  },
  game: {
    id: 'game',
    label: 'Profile G — Games',
    preferred_stack: [
      'Unity / C#', 'Unreal Engine / C++', 'Godot / GDScript',
      'Deterministic Game Loops', 'Multiplayer Netcode', 'Scene & Asset Pipelines', 'Save Systems', 'Frame/Memory Profiling'
    ],
    primary_specialists: ['game-architect', 'gameplay-programmer', 'unity-developer', 'unreal-engine-developer', 'godot-developer', 'game-qa-tester'],
    recommended_skills: ['eng-games', 'eng-quality'],
    priorities: [
      'Fixed-timestep deterministic simulation, frame-time & memory budgets, clean scene/asset ownership',
      'Never force web REST/CRUD architecture onto a real-time game loop'
    ],
    guardrails: [
      'Verify platform export builds and frame budgets before sign-off'
    ]
  },
  generic: {
    id: 'generic',
    label: 'Profile H — Generic / Existing Stack First',
    preferred_stack: ['Existing Repository Stack'],
    primary_specialists: ['fullstack-engineer', 'backend-architect', 'regression-debugger'],
    recommended_skills: ['eng-architecture', 'eng-quality'],
    priorities: [
      'Discover existing stack, tests, and conventions before applying any template',
      'Preserve working frameworks and databases; never migrate just to match defaults'
    ],
    guardrails: [
      'Respect existing architecture and dependencies'
    ]
  }
};

const PROFILE_ALIASES = {
  auto: 'auto',
  web: 'web',
  saas: 'web',
  nextjs: 'web',
  frontend: 'web',
  mobile: 'mobile',
  expo: 'mobile',
  flutter: 'mobile',
  'react-native': 'mobile',
  ai: 'ai',
  ml: 'ai',
  biometric: 'ai',
  biometrics: 'ai',
  iot: 'iot',
  fleet: 'iot',
  telematics: 'iot',
  legacy: 'legacy',
  windows: 'legacy',
  iis: 'legacy',
  sql: 'legacy',
  sqlserver: 'legacy',
  desktop: 'desktop',
  electron: 'desktop',
  tauri: 'desktop',
  enterprise: 'enterprise',
  hr: 'enterprise',
  erp: 'enterprise',
  healthcare: 'enterprise',
  game: 'game',
  games: 'game',
  unity: 'game',
  unreal: 'game',
  godot: 'game',
  generic: 'generic',
  unknown: 'generic'
};

/** Normalize a CLI or config profile identifier or alias. */
export function normalizeProfileId(raw) {
  if (!raw) return 'auto';
  const key = String(raw).trim().toLowerCase();
  const mapped = PROFILE_ALIASES[key];
  if (!mapped) {
    throw new Error(`Unknown profile "${raw}". Valid profiles: auto, ${Object.keys(PROJECT_PROFILES).join(', ')}`);
  }
  return mapped;
}

function readPackageText(projectPath) {
  const pkgFile = join(projectPath, 'package.json');
  if (!existsSync(pkgFile)) return '';
  try {
    return readFileSync(pkgFile, 'utf8');
  } catch {
    return '';
  }
}

/** Detect the closest non-invasive project profile from repository artifacts and adapters. */
export function detectProjectProfile(projectPath, stack = null) {
  const root = resolve(projectPath);
  const adapters = new Set(stack?.adapters || []);
  const pkgText = readPackageText(root);
  const reqFile = join(root, 'requirements.txt');
  const reqText = existsSync(reqFile) ? readFileSync(reqFile, 'utf8') : '';
  const combined = `${pkgText}\n${reqText}`;
  const reasons = [];

  if (adapters.has('unity') || adapters.has('unreal') || adapters.has('godot')) {
    reasons.push('Detected game engine project files');
    return { profileId: 'game', confidence: 0.95, reasons, profile: PROJECT_PROFILES.game };
  }

  if (adapters.has('iis_asp') || (adapters.has('sqlserver') && !adapters.has('nextjs')) || (adapters.has('dotnet') && existsSync(join(root, 'web.config')))) {
    reasons.push('Detected Windows IIS / Classic ASP / SQL Server system markers');
    return { profileId: 'legacy', confidence: 0.9, reasons, profile: PROJECT_PROFILES.legacy };
  }

  if (adapters.has('desktop')) {
    reasons.push('Detected Electron or Tauri desktop configuration');
    return { profileId: 'desktop', confidence: 0.9, reasons, profile: PROJECT_PROFILES.desktop };
  }

  if (adapters.has('biometrics') || /liveness|face[-_ ]?(?:recognition|verify|verification)|anti[-_ ]?spoof|fingerprint|biometric/i.test(combined)) {
    reasons.push('Detected biometric / vision AI dependencies or keywords');
    return { profileId: 'ai', confidence: 0.9, reasons, profile: PROJECT_PROFILES.ai };
  }

  if (adapters.has('iot') || /\b(gps|geofence|telemetry|telematics|fleet|mqtt|nmea|tracker)\b/i.test(combined)) {
    reasons.push('Detected IoT / GPS fleet telemetry dependencies or keywords');
    return { profileId: 'iot', confidence: 0.88, reasons, profile: PROJECT_PROFILES.iot };
  }

  if (/\b(payroll|attendance|shift|hris|erp|clinical|patient|ehr|healthcare|multi[- ]?tenant)\b/i.test(combined)) {
    reasons.push('Detected HR / ERP / Healthcare domain indicators');
    return { profileId: 'enterprise', confidence: 0.85, reasons, profile: PROJECT_PROFILES.enterprise };
  }

  if (adapters.has('expo') || adapters.has('flutter')) {
    const hasWeb = adapters.has('nextjs') || adapters.has('nestjs');
    if (!hasWeb || !adapters.has('nextjs')) {
      reasons.push('Detected Expo / React Native / Flutter mobile configuration');
      return { profileId: 'mobile', confidence: 0.88, reasons, profile: PROJECT_PROFILES.mobile };
    }
  }

  if (adapters.has('nextjs') || adapters.has('react') || adapters.has('nestjs') || adapters.has('prisma')) {
    reasons.push('Detected web / SaaS stack adapters');
    return { profileId: 'web', confidence: 0.85, reasons, profile: PROJECT_PROFILES.web };
  }

  if (adapters.has('ai_ml')) {
    reasons.push('Detected AI / ML runtime dependencies');
    return { profileId: 'ai', confidence: 0.8, reasons, profile: PROJECT_PROFILES.ai };
  }

  reasons.push('No specialized framework template dominates; preserving existing repository structure');
  return { profileId: 'generic', confidence: 0.7, reasons, profile: PROJECT_PROFILES.generic };
}
