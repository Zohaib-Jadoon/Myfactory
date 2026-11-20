# Quality & Testing Engineering Playbook

## 1. Verification Pyramid & Scope Selection
- **Unit Tests:** Pure domain logic, parsers, validators, state machines, edge cases, and error boundaries.
- **Integration Tests:** Real SQLite/Postgres constraints, transaction rollbacks, API controller-to-DB round-trips, cross-tenant denial (`403`).
- **Contract Tests:** Shared schema validation between API producers and web/mobile clients.
- **E2E Tests:** Critical browser/CLI user workflows against an isolated live test server with real teardown.

## 2. Regression & Security Testing
- Verify malformed inputs, SQL injection strings, path traversal (`../`), expired tokens, and unauthorized cross-tenant IDs return clean `4xx` responses.
- Run secret scanners (`scanSecrets`) and dependency audits (`npm audit` / `pip-audit`) on every release candidate.

## 3. Honest Reporting Rules
- Differentiate clearly between: simulated hardware/GPS tests vs physical device runs; local passing suites vs live production SLOs.
- Any missing runtime binary (`flutter`, `dotnet`, `psql`, `playwright`) leaves the gate `NOT VERIFIED` (`ok: false` for release gating).
