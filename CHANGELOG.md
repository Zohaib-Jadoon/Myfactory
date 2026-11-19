# Changelog

## v0.2.0 (2026-11-19)

- Added SQLite persistence engine (`src/db.mjs`) via Node.js built-in `node:sqlite`.
- Added security & execution boundary module (`src/security.mjs`) with secret content scanning, log redaction, path traversal jailing, policy enforcement, and DEP0190-safe Windows `safeSpawn`.
- Added universal project adapter system (`src/adapters.mjs`) supporting Next.js, React, NestJS, Node.js, Python, .NET, Flutter, Expo/React Native, PostgreSQL, SQL Server, Docker, Desktop, AI/ML, and Monorepos.
- Added 14 executable agent roles and provider compatibility detection (`src/agents.mjs`).
- Added dependency-aware DAG orchestrator (`src/orchestrator.mjs`) with bounded parallel execution, retries, cancellation, resume, isolated worktree integration, and release candidate gating.
- Upgraded quality gates (`src/gates.mjs`) with measurable metrics and explicit `NOT VERIFIED` / `BLOCKED` reporting.
- Upgraded local read-only Control Dashboard (`src/dashboard.mjs`) with SQLite-backed multi-project views and JSON APIs (`/api/overview`, `/api/projects`, `/api/health`).
- Added `/factory-init`, `/factory-status`, `/factory-test`, `/factory-review`, `/factory-fix` skills and all 11 Antigravity slash workflows under `.agents/workflows/`.
- Repaired UTF-8 BOM in installed `ponytail/plugin.json` and installed missing `agy-pstack` skills (`control-cli`, `control-ui`, `deslop`).

## v0.1.0

- Initial starter kit with JSON task tracker, Git worktrees, basic check detection, Windows installer, and 6 factory skills.

