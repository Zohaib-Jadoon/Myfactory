# Universal Software Factory: Workspace Operating Rules (`v1.0.0`)

Work from measurable, testable acceptance criteria using `factory` CLI orchestration, context-sensitive `pstack` (`poteto-mode`) and `Ponytail`, without inflating model context.

## Non-Negotiable Safeguards
1. Inspect existing code, configuration, schemas, and tests before editing. Preserve user data, public APIs, migrations, and custom rules/skills.
2. Select only relevant specialists (`factory agents select`) and stack-matched skills (`factory skills recommend`) for the task.
3. Separate inferred lessons/preferences from explicitly stated user preferences; never auto-promote unverified or failed outcomes globally.
4. Keep credentials, tokens, connection strings, PII, and raw biometric templates out of source, logs, artifacts, and all memory tiers.
5. Enforce real verification: unconfigured checks, missing runtimes, and unrun physical device tests are `NOT VERIFIED` or `BLOCKED`, never `PASS`.
6. Never fabricate test results, token savings, or production SLO metrics.
7. Work concurrent modifications in isolated Git worktrees (`factory worktree <project> --id <id>`).
8. Never terminate, restart, or modify Antigravity IDE or Cursor IDE processes.
9. Never push, merge without verification, deploy to production, run destructive DB migrations, or build signed store artifacts without explicit human approval.

## Lifecycle Workflow
`factory init .` -> `/factory-plan` (`factory plan . --goal "..."`) -> `/factory-build` (`factory run .` / worktrees) -> `/factory-test` (`factory verify .`) -> `/factory-review` (`factory review .`) -> `/factory-deploy` (`factory deploy advise .`) -> `/factory-release` (`factory release .`) -> `factory approve` -> `factory learn .`.
