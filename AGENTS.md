# Universal Software Factory: workspace rules

This repository is an Antigravity-native software factory. Work from written, testable user outcomes. For nontrivial changes, activate `factory-build`, and when present `poteto-mode` (pstack) and `ponytail` for concise implementation. For other work, select the appropriate factory skill. Never claim a skill is installed unless it is visible under Customizations / Skills.

Non-negotiable:
- Read current code, configuration and tests before editing. Protect existing data, APIs, migrations, and public behavior. Do not modify unrelated projects.
- Define testable acceptance criteria, risk, rollback and security checks. Do not fabricate tests, screenshots, production status or reliability metrics.
- Prefer the smallest complete diff using existing patterns; do not trade away security, accessibility, error handling, logging, or tests for shorter code.
- Keep secrets out of source, logs, messages, artifacts and `memory.md`. Store env variable NAMES in `.env.example`, never live values in documentation.
- Do not push, merge, deploy, overwrite databases, run migrations on production, publish packages, or produce signed/production builds without explicit owner approval.
- Use isolated worktrees/branches when parallelizing; agents must not edit one shared branch concurrently.
- For changed behavior: implement tests, run defined project checks, evaluate security and dependency risks, document failures and manual verification. Mark missing checks as BLOCKED, not PASSED.
- Do not equate passing test suites with 99.99% production accuracy or uptime. Only observed SLOs, adequate samples and real monitoring can justify such measurements.

The operator workflow is:
1. `/factory-plan`: inspect and define acceptance criteria.
2. `/factory-build`: architecture -> implementation -> tests -> independent review -> verify.
3. `/factory-verify`: execute configured automated gates; block incomplete evidence.
4. `/factory-release`: produce release candidate and require owner approval for deployment.
5. `/factory-resume`: restore status from disk without inventing context.

Task tracker CLI: `node <FACTORY_HOME>/bin/factory.mjs init <project>`, then `create`, `list`, `worktree`, `verify`, `serve`. See README.
