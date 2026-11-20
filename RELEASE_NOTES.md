# Release Notes — Myfactory `v1.0.0` Release Candidate

**Branch:** `feat/myfactory-v1.0` | **Status:** Tested Release Candidate — awaiting owner review & approval before merge/push/global host rollout.

## Highlights

- **60 Specialist Agents Across 9 Categories** (`src/agent-registry.mjs`) with auto-generated Antigravity (`.agents/agents/`) and Cursor (`.cursor/agents/`) adapters plus full 14-role legacy compatibility.
- **Smart Agent Router & Progressive Context Engine** (`src/router.mjs`, `src/context-engine.mjs`) measuring `83.55%`–`97.73%` byte reductions across benchmark modes while reporting unavailable offline LLM tokens honestly.
- **Self-Improving 3-Level Memory & Reflection** (`src/memory.mjs`, `src/improvement.mjs`) with SQLite WAL storage, cross-project lesson promotion gates, PII/biometric/secret rejection, deduplication/consolidation, and optional AES-256-GCM encryption.
- **9 Engineering Profiles** (`src/profiles.mjs`): `web`, `mobile`, `ai`, `iot`, `legacy`, `desktop`, `enterprise`, `game`, and `generic`.
- **10 Modular Engineering Playbook Skills** (`eng-*`) with lazy `references/playbook.md` and 5 conditional IDE rules (`.agents/rules/` + `.cursor/rules/*.mdc`).
- **Skill Discovery & Security Scanner** (`src/skills-engine.mjs`) auditing scripts and `SKILL.md` prior to lockfile/SQLite registration.
- **Deployment Advisor, Safe Updater & Sync, Extended Dashboard, Windows + Linux Installers** (`src/deployment-advisor.mjs`, `src/updater.mjs`, `src/dashboard.mjs`, `installer/`).

## Release Verification Summary

- All 39 automated tests pass (`0` failures, `0` skipped); secret scan reports `0` findings across `297` files.
- Host global upgrade (`Setup.ps1 -Scope Global -UpdateFactory`), live GitHub push, and Ubuntu GitHub Actions live execution await explicit user approval.
