# Test & Verification Report — Myfactory `v1.0.0`

**Branch:** `feat/myfactory-v1.0` | **Runtime:** Node.js `v24.21.0` | **OS:** Windows 11 (`win32`)

## 1. Automated Test Suite (`npm test`)

- **Command:** `node --test tests/*.test.mjs`
- **Result:** **`39` passed, `0` failed, `0` skipped** (`duration_ms: 9852.2634` on last suite run before doc additions; re-run executed in Phase 11 final verification).
- **Test Modules:**
  - `tests/factory.test.mjs` (`10`): task creation, empty gate `NOT VERIFIED` blocking, script detection, clean-commit + revision-bound approval, failing check blocking, tracked secret key blocking, worktree isolation, read-only XSS-escaped dashboard, monorepo subfolder jail, gate-config hash invalidation.
  - `tests/orchestrator.test.mjs` (`10`): secret redaction & scan, path traversal jail & safety policy, multi-stack monorepo adapter detection, missing binary `NOT VERIFIED` blocking, DAG scheduler retries/cancellation/resume/release gate, clean worktree branch merge, dashboard JSON API, full `.agent/.agents/.cursor/.factory` init preservation, Cursor `doctor` check, `copySkillDirs` loose file filtering.
  - `tests/agents-routing.test.mjs` (`6`): 60 specialists across 9 categories with 13 attributes, bidirectional 14-role mapping, native Antigravity/Cursor YAML frontmatter validation + custom file preservation, NestJS bug routing excluding unrelated domains, React Native biometric+GPS multi-domain routing, Unity game routing & `FAST` 1-agent cap.
  - `tests/memory-learning.test.mjs` (`3`): mandatory Project A -> Project B cross-project transfer + Project C isolation, global DB reopen persistence, secret/PII/biometric rejection, failed-task & unverified-assertion blocking, project conflict override, deduplication/consolidation, disable/delete, AES-256-GCM encrypted export/import round-trip, v0.2.0 -> v1.0.0 SQLite migration preserving existing tasks.
  - `tests/skills-engine.test.mjs` (`4`): offline catalog search, Next.js-only skill recommendations (excluding mobile/games/desktop bloat), security rejection (`curl|bash`, `rm -rf`, `taskkill Antigravity`, prompt injection), unallowlisted approval gate, duplicate blocking, lockfile/SQLite SHA-256 tracking & tamper detection.
  - `tests/update-sync.test.mjs` (`2`): mandatory v0.2.0 -> v1.0.0 update dry-run, user-rule preservation even under `--force`, SQLite migration, automatic failure rollback + explicit rollback, dirty Git protection, interrupted crash recovery journal Recovery, `factory sync` conflict detection/diff.
  - `tests/context-deploy-dashboard.test.mjs` (`4`): progressive context budget loading + Git/config cache invalidation, deployment advisor respecting `render.yaml` + applying verified IIS memory lesson, V1.0 read-only/XSS dashboard endpoints, CLI E2E subprocess smoke execution across 14 commands in isolated sandbox.

## 2. Sandbox Installer & Cross-Platform Smoke Verification

- **Windows (`Setup.ps1 -Scope Both -Offline`):** Verified all 9 checks in isolated `$sandbox` (`factory_home_cli`, `.factory-manifest.json`, Antigravity agent `agent.md`, Cursor subagent `.cursor/agents/*.md`, `global-memory.db`, `user-preferences.md`, `.cursor/skills-cursor` untouched, `.factory/config.json`, `.factory/memory/project-memory.md`).
- **Linux (`installer/install.sh`):** Verified bash syntax cleanly (`BASH_SYNTAX_OK=true` via `bash -n installer/install.sh`). Live Ubuntu runner execution waits for GitHub Actions CI run on push.

## 3. Security Scan & Diagnostics

- **Secret Scan (`scanSecrets('.')`):** `{"ok":true,"isGit":true,"filesScanned":297,"trackedSecretFiles":[],"findings":[]}`.
- **Doctor (`node bin/factory.mjs doctor .`):** `version: "1.0.0"`, `schema_version: 2`, `sqlite_ok: true`, `global_memory_ok: true`, `specialist_agent_count: 60`, `agent_definitions_valid: true`, `antigravity_agents_count: 60`.
- **Context Benchmark (`context benchmark .`):** Measured `baseline_bytes: 154,737` across `101` files -> `3,511` B (`FAST`, `97.73%`), `10,854` B (`STANDARD`, `92.99%`), `25,449` B (`DEEP`, `83.55%`), `22,681` B (`RELEASE`, `85.34%`); LLM token counts marked `unavailable`.

## 4. Explicit `NOT VERIFIED` Items

- **Live Antigravity & Cursor IDE UI Discovery Reload:** Files are generated and frontmatter-verified on disk, and `doctor` shows host `~/.cursor/agents` still holds the prior v0.2.0 count (`2` files) until the user approves running `Setup.ps1 -Scope Global -UpdateFactory` / `factory update` on the host machine and manually reloads IDE UI if needed.
- **GitHub Actions Remote CI Execution (`feat/myfactory-v1.0`):** Branch has not been pushed yet (awaiting explicit owner approval per requirement #15), so Ubuntu runner execution of `.github/workflows/factory-tests.yml` is `NOT VERIFIED` locally beyond `bash -n`.
- **Live Online `npx skills add` & Remote GitHub `factory update` Round-Trip:** Tested locally with real local Git repositories and fixtures; live network clone against an updated remote tag is `NOT VERIFIED` until pushed.
