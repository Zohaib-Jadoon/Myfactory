---
name: factory-resume
description: Recover interrupted or failed factory execution from persisted SQLite state without discarding completed tasks.
---

# Resume Protocol

1. Inspect current state via `node "<FACTORY_HOME>/bin/factory.mjs" status "<project>"` and `git status`.
2. Run `node "<FACTORY_HOME>/bin/factory.mjs" resume "<project>"` to transition interrupted (`running`) or failed/blocked tasks back to `queued` while preserving all completed, verified, and approved tasks.
3. Inspect `.factory/tasks/<id>.md` and latest `gate_runs` in SQLite; verify whether HEAD changed since the last verification run.
4. Continue execution via `node "<FACTORY_HOME>/bin/factory.mjs" run "<project>"` or Antigravity `/factory-build`.
