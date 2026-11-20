const stamp = () => new Date().toISOString();

export const CURRENT_SCHEMA_VERSION = 2;

export const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline_v0_2',
    sql: `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  adapter_ids TEXT NOT NULL DEFAULT '[]',
  config_json TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  current_stage TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pipeline_id TEXT REFERENCES pipelines(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  criteria TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'implementation',
  agent_role TEXT NOT NULL DEFAULT 'backend',
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 50,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  branch TEXT,
  worktree TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  verification_json TEXT,
  approval_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  event TEXT NOT NULL,
  actor TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pipeline_id TEXT,
  task_id TEXT,
  agent_role TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gate_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT,
  revision TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  config_hash TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  results_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  file_path TEXT,
  line_number INTEGER DEFAULT 0,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT,
  reviewer_role TEXT NOT NULL,
  severity TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT,
  version TEXT NOT NULL,
  revision TEXT,
  gate_run_id TEXT,
  status TEXT NOT NULL,
  notes TEXT NOT NULL,
  rollback_plan TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT,
  release_id TEXT,
  action TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  reason TEXT,
  revision TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pipeline_id TEXT,
  task_id TEXT,
  agent_role TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  output_summary TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_logs_project_time ON execution_logs(project_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_gates_project_time ON gate_runs(project_id, created_at DESC);
`
  },
  {
    version: 2,
    name: 'v1_0_learning_routing_skills_updates',
    sql: `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  project_id TEXT,
  category TEXT NOT NULL,
  statement TEXT NOT NULL,
  evidence_ref TEXT,
  source_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  verification_status TEXT NOT NULL DEFAULT 'candidate',
  tags_json TEXT NOT NULL DEFAULT '[]',
  profile_scope TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS project_profiles (
  project_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  detected_stack_json TEXT NOT NULL,
  override_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_registry (
  name TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL,
  version_ref TEXT,
  commit_sha TEXT,
  sha256 TEXT,
  license TEXT,
  compatible_ides_json TEXT NOT NULL DEFAULT '["antigravity","cursor"]',
  required_tools_json TEXT NOT NULL DEFAULT '[]',
  install_status TEXT NOT NULL,
  approval_status TEXT NOT NULL,
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  security_summary TEXT,
  installed_paths_json TEXT NOT NULL DEFAULT '[]',
  last_verified_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routing_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  task_id TEXT,
  request_summary TEXT NOT NULL,
  profile_id TEXT,
  complexity TEXT NOT NULL,
  primary_agent TEXT NOT NULL,
  supporting_agents_json TEXT NOT NULL,
  selected_skills_json TEXT NOT NULL,
  references_json TEXT NOT NULL,
  estimated_budget_chars INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_metrics (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  task_id TEXT,
  mode TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_context_bytes INTEGER NOT NULL,
  baseline_context_bytes INTEGER,
  duration_ms INTEGER,
  agent_invocations INTEGER NOT NULL DEFAULT 1,
  cost_usd REAL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  success INTEGER,
  verification_coverage REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS update_history (
  id TEXT PRIMARY KEY,
  from_version TEXT,
  to_version TEXT,
  from_commit TEXT,
  to_commit TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  backup_path TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS improvement_proposals (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  metrics_before_json TEXT,
  metrics_after_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_advice (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  profile_id TEXT,
  recommended_platform TEXT NOT NULL,
  options_json TEXT NOT NULL,
  plan_markdown TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_scope_status ON memories(scope, status, category);
CREATE INDEX IF NOT EXISTS idx_memories_project_status ON memories(project_id, status);
CREATE INDEX IF NOT EXISTS idx_memories_fingerprint ON memories(fingerprint);
CREATE INDEX IF NOT EXISTS idx_routing_project_time ON routing_decisions(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_project_time ON context_metrics(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_updates_time ON update_history(created_at DESC);
`
  }
];

/** Read current applied schema version from schema_migrations table. */
export function getSchemaVersion(sqliteDb) {
  const tableExists = sqliteDb
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!tableExists) return 0;
  const row = sqliteDb.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get();
  return Number(row?.version || 0);
}

/** Execute pending SQLite migrations transactionally in version order. */
export function runMigrations(sqliteDb) {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = sqliteDb.prepare('SELECT version FROM schema_migrations').all();
  const applied = new Set(appliedRows.map(r => Number(r.version)));
  const insertMigration = sqliteDb.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    sqliteDb.exec('BEGIN');
    try {
      sqliteDb.exec(migration.sql);
      insertMigration.run(migration.version, migration.name, stamp());
      sqliteDb.exec('COMMIT');
    } catch (err) {
      try {
        sqliteDb.exec('ROLLBACK');
      } catch {
        // Ignore rollback failure when no transaction is active.
      }
      throw new Error(`Migration v${migration.version} (${migration.name}) failed: ${err.message}`);
    }
  }

  return getSchemaVersion(sqliteDb);
}
