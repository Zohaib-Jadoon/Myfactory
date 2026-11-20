import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const AGENT_CATEGORIES = [
  'engineering',
  'product',
  'design',
  'project-management',
  'studio-operations',
  'deployment',
  'testing',
  'security',
  'game-development'
];

const CATEGORY_DEFAULTS = {
  engineering: {
    readonly: false,
    handoffFormat: 'Unified diff summary, modified file list, verification command output, and explicit unresolved gaps.',
    expectedArtifacts: ['Implemented source module(s)', 'Automated unit/integration tests', 'Migration or rollback notes if schema touched'],
    verificationCriteria: ['Configured lint, typecheck, and test gates pass on clean git HEAD', 'No new secrets or unvalidated trust boundaries'],
    humanApprovalConditions: ['Schema/data deletion', 'Production deployment or git push', 'Auth/RBAC model changes'],
    securityBoundaries: ['Validate all external/untrusted inputs at boundaries', 'Never embed secrets or bypass authz checks']
  },
  product: {
    readonly: true,
    handoffFormat: 'Structured PRD/spec markdown with numbered acceptance criteria, non-goals, and risk list.',
    expectedArtifacts: ['docs/factory/PRD.md or acceptance specification', 'Prioritized task list with testability notes'],
    verificationCriteria: ['Every requirement has measurable acceptance criteria and explicit out-of-scope boundaries'],
    humanApprovalConditions: ['Breaking API/product contract changes', 'Scope expansion beyond baseline requirements'],
    securityBoundaries: ['Do not include credentials, PII, or confidential customer records in specs']
  },
  design: {
    readonly: false,
    handoffFormat: 'Component/token specification, WCAG 2.2 AA check notes, and required state definitions (loading/empty/error/success).',
    expectedArtifacts: ['docs/factory/UI_UX_SPEC.md or component styles', 'Accessibility contrast & keyboard checklist'],
    verificationCriteria: ['All interactive controls keyboard-reachable', 'Loading, empty, error, and success states specified'],
    humanApprovalConditions: ['Major brand identity changes', 'Breaking navigation restructuring'],
    securityBoundaries: ['Sanitize user-rendered HTML/SVG to prevent XSS']
  },
  'project-management': {
    readonly: true,
    handoffFormat: 'Dependency DAG state, task owners, risk register, and go/no-go gate summary.',
    expectedArtifacts: ['DAG task plan (.factory/tasks/)', 'Integration or release readiness report'],
    verificationCriteria: ['All blocking gates verified on target revision', 'Parallel authors assigned disjoint worktrees'],
    humanApprovalConditions: ['Merge to main branch', 'Release candidate promotion', 'Production deployment'],
    securityBoundaries: ['Preserve manual approval gates and non-overridable factory safety defaults']
  },
  'studio-operations': {
    readonly: false,
    handoffFormat: 'Operational runbook delta, telemetry/log evidence, and rollback checklist.',
    expectedArtifacts: ['docs/factory/RUNBOOK.md or STATUS.md', 'Redacted diagnostic summary'],
    verificationCriteria: ['Logs exclude secrets/PII', 'Documentation matches verified repository behavior'],
    humanApprovalConditions: ['Live infrastructure restart', 'Secret rotation', 'Incident external communication'],
    securityBoundaries: ['Redact credentials/tokens from all runbooks, logs, and status docs']
  },
  deployment: {
    readonly: true,
    handoffFormat: 'Platform evaluation matrix (cost, complexity, rollback), target config diff, and pre-flight verification steps.',
    expectedArtifacts: ['Deployment plan markdown', 'Verified release checklist (no auto-deploy)'],
    verificationCriteria: ['Rollback plan documented and executable', 'Builds and smoke checks verified on target artifact'],
    humanApprovalConditions: ['Any production deployment', 'DNS/IIS live site cutover', 'Signed APK or store submission'],
    securityBoundaries: ['Never store live secrets in deployment files; reference env var names only']
  },
  testing: {
    readonly: true,
    handoffFormat: 'Exact command(s) executed, pass/fail counts, failure reproduction steps, and explicit NOT VERIFIED items.',
    expectedArtifacts: ['Gate report JSON (.factory/reports/)', 'Regression test cases or bug reproduction report'],
    verificationCriteria: ['Zero skipped/disabled assertions to force green', 'Distinguishes simulated vs hardware/live checks honestly'],
    humanApprovalConditions: ['Waiving a non-critical test warning with documented risk'],
    securityBoundaries: ['Use synthetic test fixtures only; never test against production credentials or real PII']
  },
  security: {
    readonly: true,
    handoffFormat: 'Severity-ranked findings (critical/high/medium/low), file:line references, and concrete remediation steps.',
    expectedArtifacts: ['Security scan findings in SQLite', 'Threat & boundary review summary'],
    verificationCriteria: ['0 unresolved critical/high findings', '0 tracked secret files or unredacted token leaks'],
    humanApprovalConditions: ['Accepting residual medium/low risk or security exception'],
    securityBoundaries: ['Block release if secret scan fails or trust boundary validation is missing']
  },
  'game-development': {
    readonly: false,
    handoffFormat: 'Scene/script change summary, determinism & frame-budget check, and platform export verification notes.',
    expectedArtifacts: ['Game script/system modules', 'Scene/asset validation notes', 'Playmode or unit test checks'],
    verificationCriteria: ['Fixed-timestep/frame-time budget respected', 'Platform export/build succeeds without web-stack bloat'],
    humanApprovalConditions: ['Store publishing (Steam/Mobile/Console)', 'Engine major version upgrades', 'Destructive save-format changes'],
    securityBoundaries: ['Validate multiplayer server-authoritative inputs; never trust client game state']
  }
};

function def(spec) {
  const base = CATEGORY_DEFAULTS[spec.category];
  if (!base) throw new Error(`Unknown category: ${spec.category}`);
  return {
    readonly: spec.readonly ?? base.readonly,
    supportedStacks: spec.supportedStacks || ['Any compatible repository stack'],
    requiredInputs: spec.requiredInputs || ['Task acceptance criteria', 'Inspected repository files', 'Relevant project/global memory'],
    toolsAndSkills: spec.toolsAndSkills || ['factory-build', 'poteto-mode', 'ponytail'],
    operatingProcedure: spec.operatingProcedure || [
      'Inspect target code, config, and tests before modifying anything.',
      'Retrieve only relevant project/global memory for the active stack.',
      'Implement the smallest complete change following pstack & Ponytail.',
      'Verify behavior and failures against real commands/artifacts.'
    ],
    qualityRequirements: spec.qualityRequirements || base.verificationCriteria,
    securityBoundaries: spec.securityBoundaries || base.securityBoundaries,
    handoffFormat: spec.handoffFormat || base.handoffFormat,
    expectedArtifacts: spec.expectedArtifacts || base.expectedArtifacts,
    verificationCriteria: spec.verificationCriteria || base.verificationCriteria,
    humanApprovalConditions: spec.humanApprovalConditions || base.humanApprovalConditions,
    keywords: spec.keywords || [],
    profiles: spec.profiles || ['generic'],
    ...spec
  };
}

export const SPECIALIST_AGENTS = [
  // === 1. engineering (22) ===
  def({
    id: 'frontend-developer',
    name: 'Frontend Developer Specialist',
    category: 'engineering',
    legacyRole: 'frontend',
    responsibility: 'Implements React/Next.js components, client state, forms, loading/empty/error states, and responsive UI.',
    activationConditions: 'Frontend UI code edits, Next.js App Router pages, client validation, or component tests.',
    supportedStacks: ['Next.js 14-16', 'React 19', 'TypeScript', 'Tailwind CSS v4', 'shadcn/ui'],
    toolsAndSkills: ['eng-frontend', 'poteto-mode', 'ponytail'],
    keywords: ['frontend', 'nextjs', 'next.js', 'react', 'component', 'page', 'form', 'tailwind', 'shadcn', 'css', 'ui', 'hydration', 'dashboard'],
    profiles: ['web', 'enterprise', 'iot']
  }),
  def({
    id: 'backend-architect',
    name: 'Backend Architect Specialist',
    category: 'engineering',
    legacyRole: 'backend',
    responsibility: 'Designs and implements backend APIs, NestJS/Node/Python/.NET services, DTO validation, RBAC, auth, and idempotency.',
    activationConditions: 'REST/WebSocket endpoints, authentication/authorization bugs, server business logic, or service boundaries.',
    supportedStacks: ['NestJS 11', 'Node.js', 'TypeScript', 'Python', '.NET', 'REST APIs', 'RBAC'],
    toolsAndSkills: ['eng-backend', 'eng-architecture', 'poteto-mode', 'ponytail'],
    keywords: ['backend', 'nestjs', 'api', 'auth', 'authentication', 'jwt', 'rbac', 'controller', 'service', 'endpoint', 'rest', 'server', 'middleware', 'token', 'guard'],
    profiles: ['web', 'mobile', 'ai', 'iot', 'enterprise', 'generic']
  }),
  def({
    id: 'fullstack-engineer',
    name: 'Fullstack Engineer Specialist',
    category: 'engineering',
    legacyRole: 'backend',
    responsibility: 'Delivers end-to-end cohesive slices spanning frontend UI, API contracts, validation, and tests without layer bloat.',
    activationConditions: 'Vertical feature slices touching both UI and API or general Node/TypeScript repositories.',
    supportedStacks: ['TypeScript', 'Next.js', 'Node.js', 'REST', 'SQL'],
    toolsAndSkills: ['eng-architecture', 'eng-frontend', 'eng-backend', 'ponytail'],
    keywords: ['fullstack', 'full-stack', 'end-to-end', 'feature', 'crud', 'app'],
    profiles: ['web', 'generic', 'enterprise']
  }),
  def({
    id: 'database-engineer',
    name: 'Database Engineer Specialist',
    category: 'engineering',
    legacyRole: 'database',
    responsibility: 'Designs normalized schemas, constraints, indexes, transactions, and zero-data-loss migrations.',
    activationConditions: 'Schema design, query optimization, indexing, or cross-engine database work.',
    supportedStacks: ['PostgreSQL', 'SQLite', 'Microsoft SQL Server', 'Prisma', 'Drizzle'],
    toolsAndSkills: ['eng-databases', 'poteto-mode', 'ponytail'],
    keywords: ['database', 'db', 'schema', 'migration', 'index', 'query', 'transaction', 'sql', 'constraint'],
    profiles: ['web', 'enterprise', 'legacy', 'iot', 'ai']
  }),
  def({
    id: 'postgres-neon-specialist',
    name: 'PostgreSQL & Neon Specialist',
    category: 'engineering',
    legacyRole: 'database',
    responsibility: 'Optimizes PostgreSQL queries, connection pooling, Neon serverless branching, JSONB/PostGIS indexes, and backups.',
    activationConditions: 'PostgreSQL or Neon database tuning, extensions, RLS policies, or migration debugging.',
    supportedStacks: ['PostgreSQL', 'Neon Serverless', 'pgvector', 'PostGIS', 'SQL'],
    toolsAndSkills: ['eng-databases', 'poteto-mode'],
    keywords: ['postgres', 'postgresql', 'neon', 'psql', 'postgis', 'pgvector', 'rls'],
    profiles: ['web', 'enterprise', 'iot']
  }),
  def({
    id: 'prisma-specialist',
    name: 'Prisma ORM Specialist',
    category: 'engineering',
    legacyRole: 'database',
    responsibility: 'Maintains prisma/schema.prisma models, safe migrate deploy flows, typed client queries, and N+1 elimination.',
    activationConditions: 'Prisma schema changes, migrate dev/deploy workflows, relation modeling, or query performance.',
    supportedStacks: ['Prisma', 'TypeScript', 'PostgreSQL', 'SQLite', 'SQL Server'],
    toolsAndSkills: ['eng-databases', 'ponytail'],
    keywords: ['prisma', 'schema.prisma', 'migrate', 'relation', 'orm'],
    profiles: ['web', 'enterprise']
  }),
  def({
    id: 'sql-server-specialist',
    name: 'Microsoft SQL Server Specialist',
    category: 'engineering',
    legacyRole: 'database',
    responsibility: 'Writes and optimizes T-SQL queries, stored procedures, execution plans, and backward-compatible SQL Server migrations.',
    activationConditions: 'MSSQL / T-SQL / stored procedures / sqlproj / Windows enterprise database work.',
    supportedStacks: ['Microsoft SQL Server', 'T-SQL', 'SSMS', 'sqlcmd', 'ADO/ODBC'],
    toolsAndSkills: ['eng-databases', 'poteto-mode'],
    keywords: ['sql server', 'mssql', 't-sql', 'tsql', 'stored procedure', 'sqlproj', 'sqlcmd'],
    profiles: ['legacy', 'enterprise']
  }),
  def({
    id: 'mobile-app-builder',
    name: 'Mobile App Builder Specialist',
    category: 'engineering',
    legacyRole: 'mobile',
    responsibility: 'Architects mobile app lifecycle, permissions (camera/location), offline queue sync, notifications, and APK release prep.',
    activationConditions: 'Cross-cutting mobile architecture, permissions, OS biometrics vs external devices, or Android APK builds.',
    supportedStacks: ['Expo', 'React Native', 'Flutter', 'Android APK', 'iOS'],
    toolsAndSkills: ['eng-mobile', 'poteto-mode', 'ponytail'],
    keywords: ['mobile', 'android', 'ios', 'apk', 'permission', 'camera', 'notification', 'offline'],
    profiles: ['mobile', 'ai', 'iot']
  }),
  def({
    id: 'flutter-engineer',
    name: 'Flutter Engineer Specialist',
    category: 'engineering',
    legacyRole: 'mobile',
    responsibility: 'Builds Dart/Flutter widgets, platform channels, clean state management, analyzer cleanliness, and widget/unit tests.',
    activationConditions: 'Flutter or Dart workspace (`pubspec.yaml`) implementation or debugging.',
    supportedStacks: ['Flutter', 'Dart', 'Android', 'iOS'],
    toolsAndSkills: ['eng-mobile', 'ponytail'],
    keywords: ['flutter', 'dart', 'pubspec', 'widget'],
    profiles: ['mobile']
  }),
  def({
    id: 'react-native-engineer',
    name: 'React Native & Expo Engineer',
    category: 'engineering',
    legacyRole: 'mobile',
    responsibility: 'Implements Expo / React Native screens, native modules, navigation, camera/location hooks, and EAS build config.',
    activationConditions: 'React Native or Expo (`expo`, `react-native`) feature work and debugging.',
    supportedStacks: ['Expo', 'React Native', 'TypeScript', 'EAS Build'],
    toolsAndSkills: ['eng-mobile', 'eng-frontend', 'ponytail'],
    keywords: ['react native', 'react-native', 'expo', 'eas', 'metro'],
    profiles: ['mobile', 'ai']
  }),
  def({
    id: 'ai-ml-engineer',
    name: 'AI/ML Engineer Specialist',
    category: 'engineering',
    legacyRole: 'ai_ml',
    responsibility: 'Builds inference wrappers, prompt/model boundaries, fallback strategies, dataset validation, and reproducible evaluations.',
    activationConditions: 'LLM integration, embeddings, ML model serving, evaluation harnesses, or inference optimization.',
    supportedStacks: ['Python', 'PyTorch', 'ONNX', 'Transformers', 'OpenAI/Gemini SDK', 'TypeScript'],
    toolsAndSkills: ['eng-ai-biometrics', 'poteto-mode'],
    keywords: ['ai', 'ml', 'llm', 'model', 'embedding', 'inference', 'eval', 'dataset', 'prompt'],
    profiles: ['ai', 'web']
  }),
  def({
    id: 'biometric-ai-engineer',
    name: 'Biometric AI Engineer Specialist',
    category: 'engineering',
    legacyRole: 'ai_ml',
    responsibility: 'Designs face recognition/verification, passive/active liveness, anti-spoofing, enrollment workflows, and FAR/FRR metrics without storing raw PII in factory memory.',
    activationConditions: 'Face verification, liveness detection, anti-spoofing, fingerprint vs OS biometric separation, or enrollment.',
    supportedStacks: ['Python', 'ONNX', 'MediaPipe', 'InsightFace', 'Face-API', 'Fingerprint SDKs'],
    toolsAndSkills: ['eng-ai-biometrics', 'factory-security', 'poteto-mode'],
    securityBoundaries: [
      'Never confuse OS biometric unlock (BiometricPrompt/FaceID) with external fingerprint/face identification',
      'Never persist raw biometric templates, images, or employee PII into shared factory memory'
    ],
    keywords: ['biometric', 'face', 'liveness', 'spoof', 'anti-spoofing', 'fingerprint', 'enrollment', 'far', 'frr', 'attendance'],
    profiles: ['ai', 'mobile', 'enterprise']
  }),
  def({
    id: 'geospatial-engineer',
    name: 'Geospatial Engineer Specialist',
    category: 'engineering',
    legacyRole: 'backend',
    responsibility: 'Implements GPS coordinate validation, geofencing, PostGIS/Turf queries, route history, and OpenStreetMap rendering.',
    activationConditions: 'Geofencing, GPS location evidence, maps, spatial queries, or route visualization.',
    supportedStacks: ['PostGIS', 'OpenStreetMap', 'Leaflet', 'Turf.js', 'GPS / GeoJSON'],
    toolsAndSkills: ['eng-backend', 'eng-databases', 'ponytail'],
    keywords: ['gps', 'geospatial', 'geofence', 'geofencing', 'map', 'openstreetmap', 'leaflet', 'coordinates', 'latitude', 'longitude', 'location', 'route'],
    profiles: ['iot', 'ai', 'mobile']
  }),
  def({
    id: 'iot-telematics-engineer',
    name: 'IoT & Fleet Telematics Engineer',
    category: 'engineering',
    legacyRole: 'backend',
    responsibility: 'Implements GPS tracker protocol parsers, MQTT/WebSocket ingestion, ignition/vehicle status events, and device auth while keeping simulated feeds distinct from live hardware.',
    activationConditions: 'GPS trackers, MQTT/WebSocket telemetry streams, fleet tracking, or hardware device messaging.',
    supportedStacks: ['Node.js', 'WebSockets', 'MQTT', 'TCP/UDP Parsers', 'PostgreSQL/Timescale'],
    toolsAndSkills: ['eng-backend', 'poteto-mode'],
    securityBoundaries: ['Authenticate every device packet/connection', 'Never represent simulated telemetry as a real connected vehicle'],
    keywords: ['iot', 'telematics', 'telemetry', 'fleet', 'tracker', 'mqtt', 'websocket', 'ignition', 'vehicle', 'canbus', 'nmea'],
    profiles: ['iot']
  }),
  def({
    id: 'desktop-app-builder',
    name: 'Desktop App Builder Specialist',
    category: 'engineering',
    legacyRole: 'frontend',
    responsibility: 'Builds native desktop UX, filesystem workflows, Windows installers, auto-update safety, and packaged app verification.',
    activationConditions: 'Desktop GUI packaging, installers (MSI/NSIS), offline desktop persistence, or Tauri/Electron apps.',
    supportedStacks: ['Electron', 'Tauri', 'Windows Installer', 'Node.js', 'TypeScript'],
    toolsAndSkills: ['eng-desktop', 'poteto-mode', 'ponytail'],
    keywords: ['desktop', 'installer', 'nsis', 'msi', 'tauri', 'packaged'],
    profiles: ['desktop', 'legacy']
  }),
  def({
    id: 'electron-engineer',
    name: 'Electron Engineer Specialist',
    category: 'engineering',
    legacyRole: 'frontend',
    responsibility: 'Enforces Electron security (contextIsolation, sandbox, nodeIntegration: false), typed IPC preload bridges, and packaged startup verification.',
    activationConditions: 'Electron main/preload/renderer architecture, IPC channels, or Electron packaging.',
    supportedStacks: ['Electron', 'TypeScript', 'Node.js', 'electron-builder', 'CSP'],
    toolsAndSkills: ['eng-desktop', 'factory-security'],
    keywords: ['electron', 'preload', 'ipc', 'contextisolation', 'electron-builder'],
    profiles: ['desktop']
  }),
  def({
    id: 'windows-iis-engineer',
    name: 'Windows IIS & Server Engineer',
    category: 'engineering',
    legacyRole: 'devops',
    responsibility: 'Authors safe PowerShell deployment runbooks, IIS web.config rules, Windows Service bindings, and rollback plans without interrupting running IDEs.',
    activationConditions: 'IIS hosting, `web.config`, ARR/rewrite rules, Windows Server setup, or PowerShell deployment scripts.',
    supportedStacks: ['Windows Server', 'IIS', 'web.config', 'PowerShell', 'Windows Services'],
    toolsAndSkills: ['eng-deployment', 'poteto-mode'],
    keywords: ['iis', 'web.config', 'windows server', 'app pool', 'powershell', 'windows service', 'arr'],
    profiles: ['legacy']
  }),
  def({
    id: 'legacy-asp-modernizer',
    name: 'Legacy Classic ASP Modernizer',
    category: 'engineering',
    legacyRole: 'backend',
    responsibility: 'Strangler-fig modernizes Classic ASP / VBScript / SQL Server apps incrementally while preserving live business behavior and database integrity.',
    activationConditions: 'Classic ASP (`*.asp`), VBScript, COM/ADO, or incremental Windows legacy modernization tasks.',
    supportedStacks: ['Classic ASP', 'VBScript', 'T-SQL', 'IIS', 'Node/.NET Bridges'],
    toolsAndSkills: ['eng-architecture', 'eng-databases', 'poteto-mode'],
    keywords: ['classic asp', 'vbscript', '.asp', 'legacy', 'modernize', 'strangler'],
    profiles: ['legacy']
  }),
  def({
    id: 'api-integration-engineer',
    name: 'API Integration Engineer',
    category: 'engineering',
    legacyRole: 'backend',
    responsibility: 'Integrates third-party webhooks, payment/SMS/SSO APIs with retries, timeouts, signature verification, and env-var-only secret boundaries.',
    activationConditions: 'External REST/GraphQL/webhook integration, OAuth client setup, or resilient retry/circuit wrappers.',
    supportedStacks: ['REST', 'Webhooks', 'OAuth/OIDC', 'Node.js', 'Python'],
    toolsAndSkills: ['eng-backend', 'factory-security', 'ponytail'],
    keywords: ['webhook', 'integration', 'third-party', 'oauth', 'oidc', 'stripe', 'sdk'],
    profiles: ['web', 'enterprise', 'iot']
  }),
  def({
    id: 'devops-automator',
    name: 'DevOps Automator Specialist',
    category: 'engineering',
    legacyRole: 'devops',
    responsibility: 'Creates GitHub Actions CI workflows, Dockerfiles, health checks, artifact scripts, and repeatable release runbooks.',
    activationConditions: 'CI/CD pipelines, containerization, build scripts, or pre-release packaging automation.',
    supportedStacks: ['GitHub Actions', 'Docker', 'PowerShell', 'Bash', 'Node.js'],
    toolsAndSkills: ['eng-deployment', 'factory-release', 'ponytail'],
    keywords: ['ci', 'cd', 'github actions', 'docker', 'container', 'pipeline', 'workflow', 'runbook'],
    profiles: ['web', 'mobile', 'ai', 'iot', 'legacy', 'desktop', 'enterprise', 'generic']
  }),
  def({
    id: 'rapid-prototyper',
    name: 'Rapid Prototyper Specialist',
    category: 'engineering',
    legacyRole: 'frontend',
    responsibility: 'Builds small, disposable prototypes to validate layout, timing, or architectural feasibility empirically before full build.',
    activationConditions: 'Uncertain technical spikes, UI layout experiments, or PoCs bounded away from production paths.',
    supportedStacks: ['Node.js', 'TypeScript', 'HTML/CSS', 'React'],
    toolsAndSkills: ['ponytail', 'poteto-mode'],
    keywords: ['prototype', 'spike', 'poc', 'experiment', 'sketch', 'mockup'],
    profiles: ['web', 'mobile', 'game', 'generic']
  }),
  def({
    id: 'performance-engineer',
    name: 'Performance Engineer Specialist',
    category: 'engineering',
    legacyRole: 'backend',
    responsibility: 'Profiles bottlenecks, reduces query/bundle/memory overhead, and requires before/after measurement via benchmark-checklist.',
    activationConditions: 'Latency spikes, slow DB queries, large bundles, memory leaks, or throughput improvements.',
    supportedStacks: ['Node.js', 'PostgreSQL', 'SQL Server', 'React/Next.js', 'Python'],
    toolsAndSkills: ['eng-quality', 'poteto-mode', 'ponytail'],
    keywords: ['performance', 'slow', 'latency', 'optimize', 'n+1', 'cache', 'memory', 'bundle', 'cpu'],
    profiles: ['web', 'iot', 'ai', 'enterprise', 'generic']
  }),

  // === 2. product (6) ===
  def({
    id: 'requirements-analyst',
    name: 'Requirements Analyst Specialist',
    category: 'product',
    legacyRole: 'product_manager',
    responsibility: 'Clarifies ambiguous goals into testable requirements, edge cases, non-goals, and explicit constraint checklists.',
    activationConditions: 'New project discovery, underspecified requests, or regulatory/domain compliance mapping.',
    toolsAndSkills: ['factory-plan', 'poteto-mode'],
    keywords: ['requirements', 'clarify', 'scope', 'constraints', 'compliance'],
    profiles: ['web', 'mobile', 'ai', 'enterprise', 'legacy', 'generic']
  }),
  def({
    id: 'product-manager',
    name: 'Product Manager Specialist',
    category: 'product',
    legacyRole: 'product_manager',
    responsibility: 'Produces concise PRDs (`docs/factory/PRD.md`), user stories, and measurable acceptance criteria.',
    activationConditions: 'Standard/deep feature planning, milestone definition, or new product initialization.',
    toolsAndSkills: ['factory-plan', 'eng-architecture'],
    keywords: ['prd', 'product', 'user story', 'acceptance criteria', 'roadmap'],
    profiles: ['web', 'mobile', 'enterprise', 'desktop', 'generic']
  }),
  def({
    id: 'workflow-designer',
    name: 'Workflow Designer Specialist',
    category: 'product',
    legacyRole: 'product_manager',
    responsibility: 'Maps multi-step business workflows, state transitions, approval queues, and edge-case recovery paths.',
    activationConditions: 'Approval workflows, payroll/clinical/attendance pipelines, or onboarding flows.',
    toolsAndSkills: ['eng-architecture', 'factory-plan'],
    keywords: ['workflow', 'state machine', 'approval flow', 'attendance', 'shift', 'clinical', 'payroll'],
    profiles: ['enterprise', 'web', 'ai']
  }),
  def({
    id: 'domain-modeler',
    name: 'Domain Modeler Specialist',
    category: 'product',
    legacyRole: 'architect',
    responsibility: 'Defines core domain entities, bounded contexts, multi-tenant boundaries, and invariants before coding starts.',
    activationConditions: 'Complex domain design (HR, ERP, Healthcare, Fleet, Multi-tenant SaaS) or data structure modeling.',
    toolsAndSkills: ['eng-architecture', 'poteto-mode'],
    keywords: ['domain', 'entity', 'tenant', 'multi-tenant', 'hr', 'erp', 'healthcare', 'invariant', 'bounded context'],
    profiles: ['enterprise', 'web', 'iot']
  }),
  def({
    id: 'sprint-prioritizer',
    name: 'Sprint Prioritizer Specialist',
    category: 'product',
    legacyRole: 'director',
    responsibility: 'Orders backlog deliverables by dependency risk, verification readiness, and vertical user value.',
    activationConditions: 'Large feature backlogs requiring phased sequencing into verifiable increments.',
    toolsAndSkills: ['factory-plan', 'ponytail'],
    keywords: ['prioritize', 'sprint', 'milestone', 'backlog', 'phase', 'mvp'],
    profiles: ['web', 'mobile', 'enterprise', 'generic']
  }),
  def({
    id: 'feedback-synthesizer',
    name: 'Feedback Synthesizer Specialist',
    category: 'product',
    legacyRole: 'product_manager',
    responsibility: 'Distills repeated user corrections and bug reports into structured learning candidates for the Learning Engine.',
    activationConditions: 'Post-task retrospectives, user feedback ingestion, or preference extraction.',
    toolsAndSkills: ['factory-learn'],
    keywords: ['feedback', 'lesson', 'preference', 'retrospective', 'complaint'],
    profiles: ['web', 'mobile', 'generic']
  }),

  // === 3. design (5) ===
  def({
    id: 'ui-designer',
    name: 'UI Designer Specialist',
    category: 'design',
    legacyRole: 'ui_ux',
    responsibility: 'Crafts clean, low-clutter visual hierarchy, responsive layouts, and modern dashboard typography without generic AI slop.',
    activationConditions: 'Dashboard redesigns, page layout polish, visual clutter reduction, or new UI screens.',
    toolsAndSkills: ['eng-frontend', 'ponytail'],
    keywords: ['ui designer', 'visual', 'layout', 'clutter', 'clean dashboard', 'spacing', 'typography', 'modern'],
    profiles: ['web', 'mobile', 'desktop', 'enterprise']
  }),
  def({
    id: 'ux-researcher',
    name: 'UX Researcher Specialist',
    category: 'design',
    legacyRole: 'ui_ux',
    readonly: true,
    responsibility: 'Audits user journeys, friction points, error recovery clarity, and mobile ergonomics.',
    activationConditions: 'UX usability audits, complex onboarding/enrollment flows, or mobile field-use friction.',
    toolsAndSkills: ['eng-frontend', 'eng-mobile'],
    keywords: ['ux', 'usability', 'journey', 'friction', 'user flow', 'ergonomics'],
    profiles: ['web', 'mobile', 'enterprise']
  }),
  def({
    id: 'design-system-engineer',
    name: 'Design System Engineer Specialist',
    category: 'design',
    legacyRole: 'ui_ux',
    responsibility: 'Builds reusable design tokens, Tailwind v4 CSS variables, and accessible shadcn/ui component primitives.',
    activationConditions: 'Reusable UI libraries, theme tokens, dark/light consistency, or component primitives.',
    toolsAndSkills: ['eng-frontend', 'ponytail'],
    keywords: ['design system', 'tokens', 'theme', 'primitives', 'tailwind', 'shadcn'],
    profiles: ['web', 'desktop', 'enterprise']
  }),
  def({
    id: 'brand-guardian',
    name: 'Brand Guardian Specialist',
    category: 'design',
    legacyRole: 'ui_ux',
    readonly: true,
    responsibility: 'Verifies copy tone, visual consistency, and elimination of cliché marketing/AI-slop text.',
    activationConditions: 'UI copy review, onboarding text polish, or brand consistency checks.',
    toolsAndSkills: ['poteto-mode', 'eng-frontend'],
    keywords: ['brand', 'tone', 'copy', 'consistency', 'slop'],
    profiles: ['web', 'enterprise']
  }),
  def({
    id: 'accessibility-reviewer',
    name: 'Accessibility Reviewer Specialist',
    category: 'design',
    legacyRole: 'ui_ux',
    readonly: true,
    responsibility: 'Audits WCAG 2.2 AA contrast, semantic landmarks, focus order, ARIA labels, and keyboard navigation.',
    activationConditions: 'UI verification, interactive forms/tables/dialogs, or accessibility compliance gates.',
    toolsAndSkills: ['eng-frontend', 'eng-quality'],
    keywords: ['accessibility', 'a11y', 'wcag', 'aria', 'keyboard', 'contrast', 'screen reader'],
    profiles: ['web', 'mobile', 'desktop', 'enterprise']
  }),

  // === 4. project-management (5) ===
  def({
    id: 'factory-director',
    name: 'Factory Director Specialist',
    category: 'project-management',
    legacyRole: 'director',
    responsibility: 'Coordinates task DAG decomposition, specialist routing, worktree isolation, and gate enforcement.',
    activationConditions: 'Multi-stage pipeline execution, multi-agent coordination, and crash recovery.',
    toolsAndSkills: ['factory-plan', 'factory-build', 'factory-status'],
    keywords: ['director', 'orchestrate', 'dag', 'coordinate', 'pipeline', 'resume'],
    profiles: ['web', 'mobile', 'ai', 'iot', 'legacy', 'desktop', 'enterprise', 'game', 'generic']
  }),
  def({
    id: 'solution-architect',
    name: 'Solution Architect Specialist',
    category: 'project-management',
    legacyRole: 'architect',
    responsibility: 'Defines system boundaries, API/DB contracts, ADR records, and cross-component integration design.',
    activationConditions: 'DEEP architectural tasks, greenfield systems, monorepo boundaries, or technology selection.',
    toolsAndSkills: ['eng-architecture', 'poteto-mode', 'ponytail'],
    keywords: ['architecture', 'solution architect', 'contract', 'boundary', 'monorepo', 'adr'],
    profiles: ['web', 'mobile', 'ai', 'iot', 'legacy', 'desktop', 'enterprise', 'generic']
  }),
  def({
    id: 'integration-coordinator',
    name: 'Integration Coordinator Specialist',
    category: 'project-management',
    legacyRole: 'director',
    responsibility: 'Manages clean Git worktree integration, merge ordering, contract alignment, and conflict prevention.',
    activationConditions: 'Parallel worktree branches merging into main or multi-module API/UI integration.',
    toolsAndSkills: ['factory-build', 'factory-verify'],
    keywords: ['integrate', 'merge', 'worktree', 'conflict', 'branch'],
    profiles: ['web', 'mobile', 'enterprise', 'generic']
  }),
  def({
    id: 'project-shipper',
    name: 'Project Shipper Specialist',
    category: 'project-management',
    legacyRole: 'devops',
    responsibility: 'Drives milestone completion checklists, ensures zero dangling NOT VERIFIED blockers, and prepares handoff.',
    activationConditions: 'Final milestone wrap-up, changelog readiness, and release packaging preparation.',
    toolsAndSkills: ['factory-release', 'factory-status'],
    keywords: ['ship', 'milestone', 'handoff', 'checklist'],
    profiles: ['web', 'mobile', 'desktop', 'enterprise', 'generic']
  }),
  def({
    id: 'release-manager',
    name: 'Release Manager Specialist',
    category: 'project-management',
    legacyRole: 'devops',
    responsibility: 'Prepares versioned release candidates, verifies clean HEAD + config hash, and enforces human sign-off before push/deploy.',
    activationConditions: 'RELEASE mode, release candidate creation, changelog/version tagging, or production readiness audits.',
    toolsAndSkills: ['factory-release', 'factory-verify', 'eng-deployment'],
    keywords: ['release', 'version', 'changelog', 'candidate', 'rc', 'approve', 'sign-off'],
    profiles: ['web', 'mobile', 'ai', 'iot', 'legacy', 'desktop', 'enterprise', 'game', 'generic']
  }),

  // === 5. studio-operations (4) ===
  def({
    id: 'infrastructure-maintainer',
    name: 'Infrastructure Maintainer Specialist',
    category: 'studio-operations',
    legacyRole: 'devops',
    responsibility: 'Maintains env var templates (`.env.example`), local runtime health, SQLite maintenance, and service configs without leaking secrets.',
    activationConditions: 'Environment setup, `.env.example` synchronization, Dockerfiles, or service dependencies.',
    toolsAndSkills: ['eng-deployment', 'factory-init'],
    keywords: ['env', 'infrastructure', 'runtime', 'docker', 'sqlite', 'maintenance'],
    profiles: ['web', 'legacy', 'iot', 'enterprise', 'generic']
  }),
  def({
    id: 'technical-documentarian',
    name: 'Technical Documentarian Specialist',
    category: 'studio-operations',
    legacyRole: 'documentation',
    responsibility: 'Maintains concise, accurate READMEs, architecture docs, migration guides, and changelog/memory records verified against code.',
    activationConditions: 'Documentation updates, release notes, migration guides, or API usage guides.',
    toolsAndSkills: ['factory-status', 'poteto-mode'],
    keywords: ['docs', 'documentation', 'readme', 'guide', 'changelog', 'notes'],
    profiles: ['web', 'mobile', 'ai', 'iot', 'legacy', 'desktop', 'enterprise', 'game', 'generic']
  }),
  def({
    id: 'incident-responder',
    name: 'Incident Responder Specialist',
    category: 'studio-operations',
    legacyRole: 'qa',
    responsibility: 'Triages production/staging outages, IIS/deployment crashes, collects redacted logs, stabilizes rollback, and records lessons.',
    activationConditions: 'Live outages, crash recovery, startup failures, or emergency rollback planning.',
    toolsAndSkills: ['factory-fix', 'factory-resume', 'poteto-mode'],
    keywords: ['incident', 'outage', 'crash', '500', '502', 'rollback', 'down', 'production failure'],
    profiles: ['web', 'legacy', 'iot', 'enterprise']
  }),
  def({
    id: 'observability-engineer',
    name: 'Observability Engineer Specialist',
    category: 'studio-operations',
    legacyRole: 'devops',
    readonly: true,
    responsibility: 'Designs structured redacted logging, `/health` endpoints, error boundaries, and audit trail completeness.',
    activationConditions: 'Health check endpoints, structured logging, metrics instrumentation, or audit trails.',
    toolsAndSkills: ['eng-backend', 'eng-deployment'],
    keywords: ['logging', 'observability', 'metrics', 'health', 'audit log', 'monitoring', 'telemetry'],
    profiles: ['web', 'iot', 'enterprise', 'ai']
  }),

  // === 6. deployment (1) ===
  def({
    id: 'deployment-advisor',
    name: 'Deployment Advisor Specialist',
    category: 'deployment',
    legacyRole: 'devops',
    readonly: true,
    responsibility: 'Evaluates Vercel, Render, Koyeb, IIS, Docker, VPS, EAS APK, and desktop installers using evidence and learned deployment lessons.',
    activationConditions: 'Choosing or verifying deployment strategy, hosting migrations, or generating release deployment runbooks.',
    toolsAndSkills: ['factory-deploy', 'eng-deployment', 'factory-release'],
    keywords: ['deploy', 'deployment', 'hosting', 'vercel', 'render', 'koyeb', 'iis', 'vps', 'advise'],
    profiles: ['web', 'mobile', 'ai', 'iot', 'legacy', 'desktop', 'enterprise', 'game', 'generic']
  }),

  // === 7. testing (7) ===
  def({
    id: 'api-tester',
    name: 'API Tester Specialist',
    category: 'testing',
    legacyRole: 'qa',
    readonly: true,
    responsibility: 'Writes and verifies REST contract tests covering status codes, validation failures, authz denials, and idempotency.',
    activationConditions: 'Backend endpoints, API bug verification, or contract regression testing.',
    toolsAndSkills: ['eng-quality', 'factory-test'],
    keywords: ['api test', 'contract test', 'endpoint test', 'http', 'integration test', '401', '403'],
    profiles: ['web', 'iot', 'enterprise', 'ai', 'mobile']
  }),
  def({
    id: 'e2e-tester',
    name: 'End-to-End Tester Specialist',
    category: 'testing',
    legacyRole: 'qa',
    readonly: true,
    responsibility: 'Designs deterministic Playwright/HTTP E2E user journey tests verifying real DOM/API behavior and clean teardown.',
    activationConditions: 'Critical user flows (login, checkout, enrollment, dashboard workflows) requiring E2E proof.',
    toolsAndSkills: ['eng-quality', 'factory-test'],
    keywords: ['e2e', 'playwright', 'end-to-end', 'browser test', 'user flow'],
    profiles: ['web', 'enterprise', 'desktop']
  }),
  def({
    id: 'regression-debugger',
    name: 'Regression Debugger Specialist',
    category: 'testing',
    legacyRole: 'code_review',
    readonly: false,
    responsibility: 'Traces failing tests or reported bugs back to root cause, writes a failing test first, fixes cleanly, and records the lesson.',
    activationConditions: 'Bug reports, failed builds, test regressions, or `/factory-fix` workflows.',
    toolsAndSkills: ['factory-fix', 'poteto-mode', 'ponytail'],
    keywords: ['bug', 'fix', 'debug', 'regression', 'failing', 'error', 'exception', 'stack trace', 'root cause'],
    profiles: ['web', 'mobile', 'ai', 'iot', 'legacy', 'desktop', 'enterprise', 'generic']
  }),
  def({
    id: 'performance-benchmarker',
    name: 'Performance Benchmarker Specialist',
    category: 'testing',
    legacyRole: 'qa',
    readonly: true,
    responsibility: 'Measures latency, context bytes, DB query cost, or throughput with repeatable before/after harnesses without fabricated percentages.',
    activationConditions: 'Performance verification, context budget benchmarks, or load testing.',
    toolsAndSkills: ['eng-quality', 'poteto-mode'],
    keywords: ['benchmark', 'measure', 'load test', 'latency', 'throughput', 'tokens'],
    profiles: ['web', 'iot', 'ai', 'enterprise', 'generic']
  }),
  def({
    id: 'mobile-device-tester',
    name: 'Mobile Device Tester Specialist',
    category: 'testing',
    legacyRole: 'qa',
    readonly: true,
    responsibility: 'Verifies mobile flows, camera/GPS permissions, offline handling, and APK startup while explicitly separating emulator vs real hardware.',
    activationConditions: 'Mobile QA, Android APK verification, permission denial checks, or biometric/GPS mobile tests.',
    toolsAndSkills: ['eng-mobile', 'eng-quality'],
    keywords: ['device test', 'emulator', 'physical device', 'apk test', 'mobile qa', 'gps test'],
    profiles: ['mobile', 'ai']
  }),
  def({
    id: 'database-integrity-tester',
    name: 'Database Integrity Tester Specialist',
    category: 'testing',
    legacyRole: 'qa',
    readonly: true,
    responsibility: 'Tests migrations up/rollback, constraint enforcement, foreign keys, concurrent transactions, and seed safety on isolated test DBs.',
    activationConditions: 'Database migrations, SQL triggers/procedures, or multi-tenant isolation verification.',
    toolsAndSkills: ['eng-databases', 'eng-quality'],
    keywords: ['migration test', 'db test', 'integrity', 'constraint', 'rollback', 'sql test'],
    profiles: ['web', 'legacy', 'enterprise', 'iot']
  }),
  def({
    id: 'release-verifier',
    name: 'Release Verifier Specialist',
    category: 'testing',
    legacyRole: 'qa',
    readonly: true,
    responsibility: 'Executes final quality gates on clean HEAD, validates no `NOT VERIFIED` blockers, and certifies release candidate evidence.',
    activationConditions: 'Pre-release verification, `factory verify`, and `factory release` readiness gating.',
    toolsAndSkills: ['factory-verify', 'factory-release', 'poteto-mode'],
    keywords: ['verify', 'release verify', 'gate', 'qa', 'certification', 'smoke test'],
    profiles: ['web', 'mobile', 'ai', 'iot', 'legacy', 'desktop', 'enterprise', 'game', 'generic']
  }),

  // === 8. security (1) ===
  def({
    id: 'security-reviewer',
    name: 'Security Reviewer Specialist',
    category: 'security',
    legacyRole: 'security',
    readonly: true,
    responsibility: 'Audits RBAC/tenant isolation, input validation, SQLi/XSS/SSRF/path traversal, dependency CVEs, biometric privacy, and secret leaks.',
    activationConditions: 'Auth/security changes, external skill inspection, biometric/PII handling, or `/factory-review`.',
    toolsAndSkills: ['factory-security', 'factory-review', 'eng-quality'],
    keywords: ['security', 'audit', 'rbac', 'xss', 'sqli', 'csrf', 'secret', 'privacy', 'vulnerability', 'cve', 'authz'],
    profiles: ['web', 'mobile', 'ai', 'iot', 'legacy', 'desktop', 'enterprise', 'generic']
  }),

  // === 9. game-development (9) ===
  def({
    id: 'game-architect',
    name: 'Game Architect Specialist',
    category: 'game-development',
    legacyRole: 'architect',
    responsibility: 'Designs real-time engine architecture, entity/component boundaries, deterministic simulation loops, and state management without forcing web patterns.',
    activationConditions: 'Game project initialization, core loop architecture, or cross-system game refactors.',
    supportedStacks: ['Unity / C#', 'Unreal / C++', 'Godot / GDScript', 'Custom Engines'],
    toolsAndSkills: ['eng-games', 'poteto-mode'],
    keywords: ['game architecture', 'game loop', 'ecs', 'state management', 'simulation', 'unity', 'unreal', 'godot'],
    profiles: ['game']
  }),
  def({
    id: 'gameplay-programmer',
    name: 'Gameplay Programmer Specialist',
    category: 'game-development',
    legacyRole: 'backend',
    responsibility: 'Implements player controllers, input buffering, combat/physics interactions, deterministic fixed-timestep updates, and save serialization.',
    activationConditions: 'Core gameplay mechanics, physics, input handling, AI state machines, or save/load systems.',
    supportedStacks: ['C#', 'C++', 'GDScript', 'Deterministic Fixed-Update'],
    toolsAndSkills: ['eng-games', 'ponytail'],
    keywords: ['gameplay', 'player controller', 'input', 'physics', 'save system', 'collision', 'mechanic'],
    profiles: ['game']
  }),
  def({
    id: 'unity-developer',
    name: 'Unity Developer Specialist',
    category: 'game-development',
    legacyRole: 'backend',
    responsibility: 'Builds Unity C# MonoBehaviour/ScriptableObject/URP systems, scene prefabs, and zero-allocation Update loops.',
    activationConditions: 'Unity projects (`ProjectSettings/ProjectVersion.txt`, `*.unity`, C# scripts).',
    supportedStacks: ['Unity', 'C#', 'URP/HDRP', 'Input System'],
    toolsAndSkills: ['eng-games', 'ponytail'],
    keywords: ['unity', 'monobehaviour', 'scriptableobject', 'prefab', 'c#'],
    profiles: ['game']
  }),
  def({
    id: 'unreal-engine-developer',
    name: 'Unreal Engine Developer Specialist',
    category: 'game-development',
    legacyRole: 'backend',
    responsibility: 'Implements Unreal C++/Blueprint Gameplay Framework, UPROPERTY replication, Enhanced Input, and packaging configs.',
    activationConditions: 'Unreal Engine projects (`*.uproject`, C++, Blueprints).',
    supportedStacks: ['Unreal Engine', 'C++', 'Blueprints', 'UHT'],
    toolsAndSkills: ['eng-games', 'poteto-mode'],
    keywords: ['unreal', 'uproject', 'blueprint', 'actor', 'uproperty', 'ue5'],
    profiles: ['game']
  }),
  def({
    id: 'godot-developer',
    name: 'Godot Developer Specialist',
    category: 'game-development',
    legacyRole: 'backend',
    responsibility: 'Develops Godot node trees, GDScript/C# signals, `_physics_process` determinism, and export presets.',
    activationConditions: 'Godot projects (`project.godot`, `*.gd`, `*.tscn`).',
    supportedStacks: ['Godot 4', 'GDScript', 'C#', 'Scenes/Signals'],
    toolsAndSkills: ['eng-games', 'ponytail'],
    keywords: ['godot', 'gdscript', 'tscn', 'project.godot', 'signal', '_physics_process'],
    profiles: ['game']
  }),
  def({
    id: 'multiplayer-network-engineer',
    name: 'Multiplayer Network Engineer Specialist',
    category: 'game-development',
    legacyRole: 'backend',
    responsibility: 'Designs server-authoritative state replication, client prediction/reconciliation, snapshot compression, and cheat resistance.',
    activationConditions: 'Multiplayer games, netcode synchronization, lobby state, or latency compensation.',
    supportedStacks: ['Netcode', 'WebSockets/UDP', 'Server Authoritative', 'Replication'],
    toolsAndSkills: ['eng-games', 'eng-backend'],
    keywords: ['multiplayer', 'netcode', 'replication', 'prediction', 'lobby', 'tick rate', 'authoritative'],
    profiles: ['game']
  }),
  def({
    id: 'game-performance-engineer',
    name: 'Game Performance Engineer Specialist',
    category: 'game-development',
    legacyRole: 'qa',
    responsibility: 'Audits frame-time budgets (16.6ms/8.3ms), GC spikes, draw calls, shader complexity, and texture/audio memory budgets.',
    activationConditions: 'Frame drops, GC hitches, memory budget tuning, or LOD/shader optimization in games.',
    supportedStacks: ['Frame Profiling', 'GPU/CPU Budgets', 'Memory Pools', 'Shaders'],
    toolsAndSkills: ['eng-games', 'eng-quality'],
    keywords: ['fps', 'frame budget', 'gc spike', 'draw call', 'shader', 'lod', 'profiler'],
    profiles: ['game']
  }),
  def({
    id: 'game-qa-tester',
    name: 'Game QA Tester Specialist',
    category: 'game-development',
    legacyRole: 'qa',
    readonly: true,
    responsibility: 'Tests deterministic simulation invariants, save/load round-trips, input edge cases, and build/export smoke startup.',
    activationConditions: 'Game automated tests, determinism checks, save file validation, or packaged game export QA.',
    supportedStacks: ['Unity Test Framework', 'GUT/GdUnit', 'Automation Spec'],
    toolsAndSkills: ['eng-games', 'eng-quality'],
    keywords: ['game qa', 'playtest', 'determinism', 'save test', 'export test'],
    profiles: ['game']
  }),
  def({
    id: 'asset-pipeline-engineer',
    name: 'Asset Pipeline Engineer Specialist',
    category: 'game-development',
    legacyRole: 'devops',
    responsibility: 'Governs mesh/texture/audio import presets, compression budgets, addressable bundles, and clean VCS binary tracking (LFS).',
    activationConditions: 'Asset import settings, bundle size bloat, or multi-platform texture/audio compression setups.',
    supportedStacks: ['Asset Bundles', 'Addressables', 'Git LFS', 'Import Presets'],
    toolsAndSkills: ['eng-games', 'ponytail'],
    keywords: ['asset', 'texture', 'mesh', 'audio', 'addressables', 'bundle', 'import preset', 'lfs'],
    profiles: ['game']
  })
];

export const SPECIALIST_BY_ID = new Map(SPECIALIST_AGENTS.map(a => [a.id, a]));

export const LEGACY_TO_SPECIALIST_MAP = {
  director: 'factory-director',
  product_manager: 'product-manager',
  architect: 'solution-architect',
  ui_ux: 'ui-designer',
  frontend: 'frontend-developer',
  backend: 'backend-architect',
  database: 'database-engineer',
  mobile: 'mobile-app-builder',
  ai_ml: 'ai-ml-engineer',
  security: 'security-reviewer',
  qa: 'release-verifier',
  code_review: 'regression-debugger',
  devops: 'devops-automator',
  documentation: 'technical-documentarian'
};

/** Resolve either a V1.0 specialist ID or one of the 14 legacy role IDs. */
export function resolveSpecialist(idOrLegacy) {
  if (!idOrLegacy) return SPECIALIST_BY_ID.get('backend-architect');
  if (SPECIALIST_BY_ID.has(idOrLegacy)) return SPECIALIST_BY_ID.get(idOrLegacy);
  if (LEGACY_TO_SPECIALIST_MAP[idOrLegacy]) return SPECIALIST_BY_ID.get(LEGACY_TO_SPECIALIST_MAP[idOrLegacy]);
  return null;
}

function shortDesc(text, max = 115) {
  const clean = String(text || '').replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3)}...`;
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function renderSharedBody(agent) {
  return [
    `- **ID:** \`${agent.id}\` | **Category:** \`${agent.category}\` | **Legacy Role Mapping:** \`${agent.legacyRole}\``,
    `- **Engineering Responsibility:** ${agent.responsibility}`,
    `- **Activation Conditions:** ${agent.activationConditions}`,
    `- **Supported Stacks:** ${agent.supportedStacks.join(', ')}`,
    `- **Required Inputs & Context:** ${agent.requiredInputs.join('; ')}`,
    `- **Tools & Skill Dependencies:** ${agent.toolsAndSkills.map(s => `\`${s}\``).join(', ')}`,
    ``,
    `## Operating Procedure`,
    ...agent.operatingProcedure.map((step, idx) => `${idx + 1}. ${step}`),
    ``,
    `## Quality & Verification`,
    `- **Quality Requirements:** ${agent.qualityRequirements.join('; ')}`,
    `- **Verification Criteria:** ${agent.verificationCriteria.join('; ')}`,
    `- **Expected Output Artifacts:** ${agent.expectedArtifacts.join('; ')}`,
    `- **Handoff Format:** ${agent.handoffFormat}`,
    ``,
    `## Security & Approval Boundaries`,
    `- **Security Boundaries:** ${agent.securityBoundaries.join('; ')}`,
    `- **Conditions Requiring Human Approval:** ${agent.humanApprovalConditions.join('; ')}`,
    ``
  ].join('\n');
}

export function renderCanonicalAgentMd(agent) {
  return [
    `---`,
    `id: ${agent.id}`,
    `name: "${agent.name}"`,
    `category: ${agent.category}`,
    `legacy_role: ${agent.legacyRole}`,
    `readonly: ${Boolean(agent.readonly)}`,
    `---`,
    ``,
    `# ${agent.name}`,
    ``,
    renderSharedBody(agent)
  ].join('\n');
}

export function renderAntigravityAgentMd(agent) {
  return [
    `---`,
    `name: ${agent.id}`,
    `description: "${shortDesc(`${agent.activationConditions}`)}"`,
    `category: ${agent.category}`,
    `legacy_role: ${agent.legacyRole}`,
    `readonly: ${Boolean(agent.readonly)}`,
    `stacks: [${agent.supportedStacks.map(s => `"${s.replace(/"/g, "'")}"`).join(', ')}]`,
    `skills: [${agent.toolsAndSkills.map(s => `"${s}"`).join(', ')}]`,
    `---`,
    ``,
    `# ${agent.name}`,
    ``,
    renderSharedBody(agent)
  ].join('\n');
}

export function renderCursorAgentMd(agent) {
  return [
    `---`,
    `name: ${agent.id}`,
    `description: "${shortDesc(`${agent.responsibility}`)}"`,
    `model: inherit`,
    `readonly: ${Boolean(agent.readonly)}`,
    `---`,
    ``,
    `# ${agent.name}`,
    ``,
    renderSharedBody(agent)
  ].join('\n');
}

function writeManagedFile(absPath, content, manifestPrev, preserveCustom, manifestOut, relKey) {
  mkdirSync(dirname(absPath), { recursive: true });
  const newHash = sha256(content);
  if (existsSync(absPath) && preserveCustom) {
    const existing = readFileSync(absPath, 'utf8');
    const existingHash = sha256(existing);
    const prevKnown = manifestPrev[relKey];
    if (existingHash === newHash) {
      manifestOut[relKey] = newHash;
      return 'unchanged';
    }
    if (prevKnown && existingHash !== prevKnown) {
      manifestOut[relKey] = prevKnown;
      return 'preserved_custom';
    }
    if (!prevKnown) {
      manifestOut[relKey] = prevKnown || existingHash;
      return 'preserved_custom';
    }
  }
  writeFileSync(absPath, content, 'utf8');
  manifestOut[relKey] = newHash;
  return 'written';
}

/** Generate canonical (.agent/agents), Antigravity (.agents/agents), and Cursor (.cursor/agents) definitions. */
export function generateAgentAdapters(rootDir, { preserveCustom = true, overwriteUnmanifested = false } = {}) {
  const root = resolve(rootDir);
  const manifestPath = join(root, '.agent', 'agents', 'manifest.json');
  let prevFiles = {};
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
      prevFiles = parsed.files || {};
    } catch {
      prevFiles = {};
    }
  }

  const stats = { written: 0, unchanged: 0, preserved_custom: 0, total_agents: SPECIALIST_AGENTS.length };
  const nextFiles = {};
  const effectivePreserve = overwriteUnmanifested ? false : preserveCustom;

  for (const agent of SPECIALIST_AGENTS) {
    const outputs = [
      [`.agent/agents/${agent.category}/${agent.id}.md`, renderCanonicalAgentMd(agent)],
      [`.agents/agents/${agent.id}/agent.md`, renderAntigravityAgentMd(agent)],
      [`.cursor/agents/${agent.id}.md`, renderCursorAgentMd(agent)]
    ];
    for (const [rel, body] of outputs) {
      const res = writeManagedFile(join(root, rel), body, prevFiles, effectivePreserve, nextFiles, rel);
      stats[res] += 1;
    }
  }

  mkdirSync(dirname(manifestPath), { recursive: true });
  const byCategory = {};
  for (const cat of AGENT_CATEGORIES) {
    byCategory[cat] = SPECIALIST_AGENTS.filter(a => a.category === cat).map(a => a.id);
  }
  const manifest = {
    schema_version: 1,
    total_agents: SPECIALIST_AGENTS.length,
    categories: byCategory,
    legacy_role_mapping: LEGACY_TO_SPECIALIST_MAP,
    files: nextFiles
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return stats;
}

function parseFrontmatter(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return fields;
}

/** Validate generated Antigravity and Cursor agent definition files for frontmatter & required sections. */
export function validateAgentDefinitions(rootDir) {
  const root = resolve(rootDir);
  const errors = [];
  let checked = 0;

  for (const agent of SPECIALIST_AGENTS) {
    const agyPath = join(root, '.agents', 'agents', agent.id, 'agent.md');
    const curPath = join(root, '.cursor', 'agents', `${agent.id}.md`);
    const canPath = join(root, '.agent', 'agents', agent.category, `${agent.id}.md`);

    for (const [label, filePath, reqFields] of [
      ['canonical', canPath, ['id', 'name', 'category', 'legacy_role']],
      ['antigravity', agyPath, ['name', 'description', 'category', 'legacy_role', 'readonly']],
      ['cursor', curPath, ['name', 'description', 'model', 'readonly']]
    ]) {
      if (!existsSync(filePath)) {
        errors.push(`Missing ${label} definition: ${filePath}`);
        continue;
      }
      checked += 1;
      const body = readFileSync(filePath, 'utf8');
      const fm = parseFrontmatter(body);
      if (!fm) {
        errors.push(`Invalid YAML frontmatter in ${label}: ${filePath}`);
        continue;
      }
      for (const key of reqFields) {
        if (!fm[key]) errors.push(`Missing frontmatter "${key}" in ${filePath}`);
      }
      for (const heading of ['## Operating Procedure', '## Quality & Verification', '## Security & Approval Boundaries']) {
        if (!body.includes(heading)) errors.push(`Missing section "${heading}" in ${filePath}`);
      }
    }
  }

  return { ok: errors.length === 0, checked, total_agents: SPECIALIST_AGENTS.length, errors };
}
