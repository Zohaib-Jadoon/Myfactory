# Changelog

## v1.0.0 (2026-11-20)

- **Core & Migrations:** Versioned transactional SQLite migrations (`src/migrations.mjs` v1 -> v2, preserving v0.2.0 data), 8 new tables, `FACTORY_GLOBAL_HOME` isolation, 9 engineering project profiles (`src/profiles.mjs`), and stack adapters for Prisma, Windows IIS/ASP, Unity, Unreal, Godot, IoT/telematics, and Biometrics.
- **60 Specialist Agents & Smart Router:** Categorized canonical library (`.agent/agents/`), 60 Antigravity adapters (`.agents/agents/`), 60 Cursor subagents (`.cursor/agents/`), 14 legacy role bidirectional mapping, and domain-bounded complexity routing (`FAST`/`STANDARD`/`DEEP`/`RELEASE`).
- **3-Level Memory & Learning Engine:** Task, Project, and Global SQLite memory (`src/memory.mjs`), candidate approval workflow, explicit vs inferred preference distinction, project override resolution, PII/secret/biometric guards, consolidation, AES-256-GCM encrypted export/import, and workflow effectiveness proposals (`src/improvement.mjs`).
- **Context Optimization:** Progressive 10-step context loader (`src/context-engine.mjs`), Git/config-invalidated summary cache, and measured byte benchmark (`context benchmark`).
- **Skill Discovery & Security:** Search, stack-matched recommendations, pre-install `SKILL.md` + script security scanner (`src/skills-engine.mjs`), reviewed allowlist (`src/skill-allowlist.json`), and SHA-256 `.factory/skills-lock.json`.
- **Engineering Standards & Conditional Rules:** 10 progressive `eng-*` skills with lazy `references/playbook.md`, 5 conditional Antigravity/Cursor rules, portable workflows/rules without hardcoded user paths, and 4 new slash commands (`factory-update`, `factory-learn`, `factory-skills`, `factory-deploy`).
- **Deployment Advisor & Safe Updater:** Platform evaluation across 11 targets (`src/deployment-advisor.mjs`), manifest-tracked self-update/sync with dirty-Git guard, backups, crash recovery, and automatic rollback (`src/updater.mjs`).
- **Dashboard, CLI & Linux Support:** Extended read-only dashboard JSON APIs & views (`src/dashboard.mjs`), complete CLI command suite (`bin/factory.mjs`), `-Offline` + backup upgrades in Windows installers, new `installer/install.sh` for Ubuntu/Linux, and 39 automated tests.

## v0.2.0 (2026-11-19)

- Added SQLite persistence (`src/db.mjs`), secret scanning/path jailing (`src/security.mjs`), project adapters, 14-agent DAG orchestrator, loopback Control Room dashboard, Cursor IDE integration, and automatic missing pstack/Ponytail cloning.

## v0.1.0

- Initial starter kit with JSON task tracker, Git worktrees, basic check detection, Windows installer, and 6 factory skills.
