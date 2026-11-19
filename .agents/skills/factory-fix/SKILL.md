---
name: factory-fix
description: Diagnose blocked or failed tasks, security findings, and gate failures, apply root-cause fixes, and re-verify without losing completed work.
---

# Factory Fix Protocol

1. Run `node "<FACTORY_HOME>/bin/factory.mjs" fix "<project>"` to gather failing tasks, latest failed gate runs, and open security/review findings from SQLite.
2. Trace each failure back to its root cause (applying `principle-fix-root-causes` and Ponytail shared-path fixes). Never suppress errors or bypass failing tests.
3. Apply the minimal complete fix inside the task's isolated worktree (if assigned) or clean branch, add a regression test, and commit cleanly.
4. Re-queue and re-verify via `node "<FACTORY_HOME>/bin/factory.mjs" fix "<project>" --retry` and `verify "<project>"`.

