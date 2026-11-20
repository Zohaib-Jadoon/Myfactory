# Safe Update & Project Sync System (`src/updater.mjs`)

`factory update` and `factory sync` keep the global factory and initialized repositories current while preserving user customizations, dirty Git working trees, and SQLite data.

## `factory update` Capabilities & Flags

- `factory update --check`: Inspect version, commit, and file delta without modifying disk.
- `factory update --dry-run`: Preview added, updated, and preserved customized files cleanly.
- `factory update --yes`: Apply update with timestamped backup, DB snapshot, migrations, and smoke check.
- `factory update --skills` / `--no-skills`: Control lockfile skill updates alongside core update.
- `factory update --force`: Re-validates payload while **still backing up and preserving user-customized files**.
- `factory update --rollback [--rollback-id <id>]`: Restore prior managed files from backup.

## Safety & Crash Recovery

1. **Manifest Diffing:** Factory-managed paths are SHA-256 tracked in `.factory-manifest.json`. Modified managed files and `custom-*`/`user-*` rules are never overwritten.
2. **Dirty Git Tree Protection:** Refuses destructive updates if `git status --porcelain` shows uncommitted modifications in the factory repository.
3. **Staging Validation & Auto-Rollback:** Validates payload syntax (`node --check bin/factory.mjs`) before copying, writes `.factory-update-in-progress.json` for crash recovery (`recoverInterruptedUpdate`), verifies post-update `version` command + SQLite schema v2 migration, and rolls back automatically on failure.

## Project Synchronization (`factory sync .`)

Updates factory-managed core skills (`factory-*`), workflows, core quality rules, and generated subagents in initialized projects using `.factory/sync-manifest.json`. Customized project files trigger conflict warnings (`conflict_preserved`) with a line diff preview and are never overwritten silently.

```bash
factory update --check
factory update --dry-run
factory update --yes
factory sync . --dry-run
factory sync .
```
