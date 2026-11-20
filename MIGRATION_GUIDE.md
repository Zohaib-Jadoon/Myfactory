# Migration Guide (`v0.1.0 / v0.2.0` -> `v1.0.0`)

Myfactory v1.0 preserves existing tasks, projects, SQLite rows, quality gates, and customized rules/skills.

## Automatic SQLite Schema Migration (`v1` -> `v2`)

Opening any v0.2.0 `factory.db` via v1.0 CLI (`factory doctor .`, `factory init .`, `factory status .`, `factory update`) executes [`src/migrations.mjs`](src/migrations.mjs):
1. Records `schema_migrations` version `1` (`baseline_v0_2`) using idempotent `CREATE TABLE IF NOT EXISTS` statements, preserving all existing `projects`, `pipelines`, `tasks`, `gate_runs`, `releases`, and `approvals` rows.
2. Transactionally applies version `2` (`v1_0_learning_routing_skills_updates`), adding `memories`, `project_profiles`, `skill_registry`, `routing_decisions`, `context_metrics`, `update_history`, `improvement_proposals`, and `deployment_advice`.

## Safe Upgrade Workflow

```powershell
# 1. Preview changes safely
factory update --source C:\Tools\Myfactory --dry-run

# 2. Apply update (creates timestamped backup, preserves customized rules/skills, runs migrations)
factory update --source C:\Tools\Myfactory --yes

# 3. Synchronize an initialized project cleanly
cd C:\Projects\MyApp
factory sync . --dry-run
factory sync .
```

## Breaking-Change Summary

- **None for core v0.2.0 commands:** `init`, `create`, `list`, `plan`, `run`, `status`, `worktree`, `integrate`, `verify`, `review`, `fix`, `release`, `approve`, `resume`, `cancel`, `logs`, `agents`, `serve`, and `doctor` keep their existing contracts.
- **Portable workflows & rules:** Hardcoded `C:/Users/...` paths were removed from `.agents/workflows/` and `.agents/rules/`. Re-run `Setup.ps1 -Scope Global -UpdateFactory` or `factory sync .` to refresh unmodified defaults.
