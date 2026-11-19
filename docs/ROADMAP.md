# Roadmap and truthful readiness

## Implemented in v0.1
- Native Antigravity reusable skills, user/global installer and project rules.
- Third-party pstack and Ponytail installer (clones upstream source on user's PC).
- Node zero-dependency task tracker; Git worktrees; task prompt generation.
- Node/Python/Flutter default quality-gate detection; per-project overrides and blocking failures.
- Read-only localhost dashboard; tracked sensitive filename check; revision-bound human approval.

## Next (not implemented)
- SQLite/PostgreSQL backed distributed queue with task concurrency, retries and leases.
- Deep Antigravity CLI/SDK integration for automatic role invocation and durable sessions.
- Live GitHub/CI integration with review, branch protection, CodeQL, Gitleaks and dependency audits.
- Browser/device simulator E2E, load/accessibility/reliability checks and screenshots.
- Cloud deploy adapters with deliberate authorization and staging canary + rollback.
- SLO measurement, production tracing and incident response.
- Multi-tenant RBAC control plane, credential vault, isolation and policy engine.

Current status: useful local development starter, **not production-ready factory infrastructure**.
