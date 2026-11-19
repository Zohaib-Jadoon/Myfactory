# Skills Registry

Verified inventory of Antigravity skills, workflows, and third-party engineering stacks installed for the Universal AI Software Factory.

## 1. Factory Native Skills & Workflows (`v0.2.0`)

- **Source:** Local repository `.agents/skills/` and `.agents/workflows/`
- **License:** Workspace-local factory components
- **Global Install Paths:** `C:\Users\CP\.gemini\config\skills\factory-*`, `C:\Users\CP\.gemini\workflows\factory-*.md`, `C:\Users\CP\.agents\workflows\factory-*.md`, `C:\Users\CP\.gemini\config\rules\factory-quality.md`

| Skill / Command | Status | Purpose |
|---|---|---|
| `factory-init` (`/factory-init`) | Installed globally | Initialize project `.factory/`, detect adapters, register SQLite |
| `factory-plan` (`/factory-plan`) | Installed globally | Create 14-agent DAG pipeline & PRD |
| `factory-build` (`/factory-build`) | Installed globally | Execute orchestrator, isolated worktrees, pstack + Ponytail build |
| `factory-status` (`/factory-status`) | Installed globally | Query SQLite tasks, blockers, gates, and approvals |
| `factory-test` (`/factory-test`) | Installed globally | Execute configured quality gates & metrics |
| `factory-review` (`/factory-review`) | Installed globally | Run Security + Code Review audits |
| `factory-fix` (`/factory-fix`) | Installed globally | Diagnose failures and re-run after root-cause fix |
| `factory-release` (`/factory-release`) | Installed globally | Prepare gated release candidate & human approval request |
| `factory-resume` (`/factory-resume`) | Installed globally | Recover interrupted/failed tasks from SQLite |
| `factory-verify` (`/factory-verify`) | Installed globally | Verification protocol alias |
| `factory-security` (`/factory-security`) | Installed globally | Threat modeling & secret/authz audit protocol |

## 2. pstack Integration

- **Authentic Upstream Source:** `https://github.com/pstack-ports/agy-pstack` (Antigravity port of Lauren Tan's `pstack` from `cursor/plugins`)
- **Verified Version / Commit:** `0.15.43` (commit `a96658a5fef674d26ba623124a51af61c3f91003`, pushed `2026-11-17T01:54:50Z`)
- **License:** MIT License (`Copyright (c) 2026 Lauren Tan`)
- **Installed Skills (`39` workflow/utility skills + `25` `principle-*` leaf skills):**
  `architect`, `arena`, `automate-me`, `benchmark-checklist`, `blast-radius`, `bro`, `control-cli`, `control-ui`, `correct`, `create-formal-verification-skill`, `create-verification-skill`, `deslop`, `figure-it-out`, `how`, `in-your-own-words`, `interrogate`, `ketchup`, `ketchup-video`, `maintain-formal-verification-skill`, `maintain-verification-skill`, `make-bot-ui`, `no-comments`, `poteto-help`, `poteto-mode`, `recall`, `reflect`, `setup-pstack`, `sharpen`, `show-me-your-work`, `statechart`, `swarm`, `tdd`, `teach`, `technical-writing`, `typescript-best-practices`, `unslop`, `why`, plus all 25 `principle-*` skills.
- **Note on IDE Refresh:** `control-cli`, `control-ui`, and `deslop` were installed into `C:\Users\CP\.gemini\config\skills\` during this session; Antigravity IDE UI skill listing refresh is **PENDING MANUAL RESTART** if not dynamically reloaded.

## 3. Ponytail Integration

- **Authentic Upstream Source:** `https://github.com/DietrichGebert/ponytail`
- **Verified Installed Version / Commit:** `4.9.0` (commit `2ed6c52`, `C:\Users\CP\.gemini\config\plugins\ponytail`)
- **License:** MIT License (`Copyright (c) 2026 DietrichGebert`)
- **Installed Skills:** `ponytail`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`, `ponytail-review`
- **Repair Applied:** Stripped invalid UTF-8 BOM (`\ufeff`) from `C:\Users\CP\.gemini\config\plugins\ponytail\plugin.json` that caused repeated `plugins.go:502` parse errors in Antigravity `language_server.log`.

## 4. Instruction Conflict Resolution Policy

When rules across `factory-*`, `pstack`, and `Ponytail` overlap, precedence is strictly:
1. **Safety & Security First:** Never bypass authz, input validation, path boundaries, secret scanning, or human approval gates (`factory-security` + Ponytail "When NOT to be lazy").
2. **Correctness & Truthful Verification:** Never fabricate test passes or omit verification (`factory-verify` + `pstack` `principle-prove-it-works`).
3. **Minimal Complete Diff (Ponytail + pstack `principle-laziness-protocol`):** Prefer stdlib (`node:sqlite`, `node:http`), avoid speculative abstractions, and reuse existing helpers.
4. **Prose & Comment Hygiene:** Follow `pstack` `unslop`/`no-comments` and user `/anti-slop` rules while preserving requested explanatory reports.

