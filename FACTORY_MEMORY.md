# Factory Memory

Durable operational log and state for the Universal AI Software Factory (Google Antigravity IDE, Windows 11).

## 1. Incident Investigation: Previous IDE Shutdown (2026-11-19)

**Conclusion (Verified from logs):** Antigravity IDE was restarted by its own built-in auto-updater (`v2.32.2` -> `v2.33.0`), NOT by any factory script, agent command, `taskkill`, or `Stop-Process`.

### Supporting Evidence
- **Conversation transcript (`transcript.jsonl`)**: Steps 0–20 (`12:12:51` to `12:13:18` +05:00) executed only read-only workspace inspection commands (`Get-ChildItem`, `node -v`, `read_file`). Zero destructive or process-terminating commands were issued.
- **Antigravity Electron log (`%APPDATA%\Antigravity\logs\main.log`)**:
  - `12:11:32.925`: `[AutoUpdater] Checking for update…`
  - `12:11:33.415`: `Found version 2.33.0`
  - `12:12:14.136`: `New version 2.33.0 has been downloaded to C:\Users\CP\AppData\Local\antigravity-updater\pending\Antigravity-x64.exe`
  - `12:13:17.415`: `Shutting down language server…`
  - `12:13:17.472`: `Auto install update on quit` -> `Executing: C:\Users\CP\AppData\Local\antigravity-updater\pending\Antigravity-x64.exe with args: --updated,/S`
- **Antigravity Language Server startup log (`%USERPROFILE%\.gemini\antigravity\log\cli-20261119_121448.log`)**:
  - `12:14:48.682`: `Language server version: 2.33.0` (restarted after auto-update completed).
- **Separate OS events prior to session**: Windows System Event Log recorded BugChecks at `11:00:06` and `12:04:03` (`111926-8234-01.dmp`, `111926-7734-01.dmp`), both prior to this session's start at `12:11:22`.
- **Secondary defect repaired**: `C:\Users\CP\.gemini\config\plugins\ponytail\plugin.json` contained a UTF-8 BOM (`\ufeff`), causing `plugins.go:502` JSON parse errors every 10 seconds. Removed BOM cleanly.

### Safeguards Enforced
- Factory scripts and CLI (`bin/factory.mjs`, `installer/*.ps1`) never terminate, reload, or restart Antigravity IDE or parent processes.
- Any global skill/workflow changes requiring an IDE UI refresh are marked **PENDING MANUAL RESTART**.

---

## 2. Implementation Phases & Verification Status

- [x] **Phase 1: Audit, Shutdown Investigation & Foundation Repair**
  - Audited starter repo (`bin/factory.mjs`, `tests/factory.test.mjs`, `installer/*.ps1`, `.agents/skills/*`).
  - Removed UTF-8 BOM from `C:\Users\CP\.gemini\config\plugins\ponytail\plugin.json`.
  - Verified `pstack-ports/agy-pstack` (`0.15.43`, MIT) and `DietrichGebert/ponytail` (`4.9.0`, MIT); installed missing `control-cli`, `control-ui`, and `deslop` skills globally.
- [x] **Phase 2: SQLite State Store, Security Scanner & Universal Project Adapters** (`src/db.mjs`, `src/security.mjs`, `src/adapters.mjs`)
  - Implemented `node:sqlite` WAL database (`factory.db`) with 11 tables.
  - Fixed Node 24 `DEP0190` warning via `safeSpawn()`, added secret content scanning, log redaction, path traversal jailing, and policy enforcement.
  - Added 13+ project stack adapters with runtime detection.
- [x] **Phase 3: Multi-Agent Orchestrator, 14 Agent Roles, DAG Scheduler & Release Gates** (`src/agents.mjs`, `src/orchestrator.mjs`, `src/gates.mjs`)
  - Implemented 14 executable agent roles, 13-stage pipeline, dependency DAG scheduler, parallel execution, retries, cancellation, resume, worktree integration, and release candidate gating (`PASS` / `FAIL` / `NOT VERIFIED`).
- [x] **Phase 4: Upgraded CLI & SQLite-Backed Control Dashboard** (`bin/factory.mjs`, `src/dashboard.mjs`)
  - Added `plan`, `run`, `status`, `integrate`, `review`, `fix`, `release`, `resume`, `cancel`, `logs`, `agents` while preserving all v0.1 exports.
  - Built loopback-only, read-only SQLite Control Room UI + `/api/overview`, `/api/projects`, `/api/health`.
- [x] **Phase 5: Antigravity Native Skills, Slash Workflows, Rules & Installer**
  - Created and globally installed 11 `factory-*` skills (`C:\Users\CP\.gemini\config\skills\`), 11 slash workflows (`C:\Users\CP\.gemini\workflows\` & `C:\Users\CP\.agents\workflows\`), and `factory-quality.md` (`C:\Users\CP\.gemini\config\rules\`).
- [x] **Phase 6: Tests, Documentation & Real Disposable E2E Validation**
  - `npm test`: `17/17` passing (`tests/factory.test.mjs` + `tests/orchestrator.test.mjs`).
  - Validated all 10 E2E steps on disposable `$env:TEMP\factory-demo-notes-app` (Notes REST API in isolated Git worktree, verification, merge, review, release candidate, deliberate lint failure blocking release, interrupted `qa` task recovery via `resume`, and live dashboard HTTP/JSON verification).
  - Authored `README.md`, `FACTORY_MEMORY.md`, `FACTORY_ARCHITECTURE.md`, `SKILLS_REGISTRY.md`, `QUALITY_GATES.md`, `SECURITY.md`, `ENVIRONMENT.md`, `CHANGELOG.md`.
- [x] **Phase 7: Dual-IDE Support (Cursor IDE + Antigravity IDE)**
  - Added `.cursor/rules/factory-quality.mdc` (`alwaysApply: true`) and made all 11 `factory-*` skills IDE-neutral using `factory <cmd>` CLI + fallback.
  - Added `cursor-ide` provider detection in `src/agents.mjs` and Cursor skill/rule checks in `bin/factory.mjs` `doctor()`.
  - Updated `factory init .` (`opts.full`) and `installer/Install-Factory.ps1` to scaffold/install `.cursor/rules` and `.cursor/skills` (`~/.cursor/skills`, `~/.cursor/rules/factory-quality.mdc`, `~/.cursor/rules/pstack-models.mdc`) and mirror local `pstack`/`ponytail` skills to `~/.cursor/skills` without touching `~/.cursor/skills-cursor/`.
- [x] **Phase 8: Auto-Install Missing pstack & Ponytail From Upstream Repos**
  - Updated `installer/Install-Factory.ps1`, `installer/Setup.ps1`, and `bin/factory.mjs` (`ensureExternalSkills` + `copySkillDirs`) to automatically clone and install missing `pstack` (`https://github.com/backnotprop/pstack.git`) and `Ponytail` (`https://github.com/DietrichGebert/ponytail.git`) without overwriting existing skills or copying loose `plugin.json` files.

## 3. Remaining Gaps / Known Limitations

- External CLI providers (`claude`, `codex`, `gemini` CLI) are installed on PATH (`available: true`), but env API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) are not set (`authenticated: false` in `doctor`), and headless external CLI dispatch is not yet wired (implementation tasks pause as `awaiting_agent` for Antigravity IDE `/factory-build` or explicit `.factory/workers/*.mjs` handlers).
- Newly installed global skills/workflows (`factory-init`, `factory-status`, `factory-test`, `factory-review`, `factory-fix`, `control-cli`, `control-ui`, `deslop`) are **PENDING MANUAL RESTART** for Antigravity IDE's UI skill dropdown if not dynamically reloaded.
- Production deployment, GitHub Actions dispatch, and signed mobile APK builds remain intentionally manual (`automatic_deployment: false`).
