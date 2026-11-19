# Factory Architecture

## System Overview

The Universal AI Software Factory separates **orchestration state** (SQLite + per-project `.factory/`) from **code execution boundaries** (isolated Git worktrees) and **IDE interaction** (Antigravity Skills, Workflows, and Rules).

```text
Antigravity IDE (/factory-* workflows, skills, rules, poteto-mode, ponytail)
        │
        ▼
Factory CLI (bin/factory.mjs)
  ├── SQLite Store (src/db.mjs -> node:sqlite WAL)
  ├── Project Adapters (src/adapters.mjs)
  ├── Security & Boundary Guard (src/security.mjs)
  ├── 14-Agent Execution Engine (src/agents.mjs)
  ├── DAG Orchestrator & Worktree Manager (src/orchestrator.mjs)
  ├── Quality Gates & Metrics (src/gates.mjs)
  └── Control Room Dashboard (src/dashboard.mjs -> 127.0.0.1:4177)
```

## 13-Stage Software Delivery Lifecycle

1. `requirements` — Product Manager Agent generates `docs/factory/PRD.md`.
2. `planning` — Factory Director Agent builds dependency DAG.
3. `architecture` — Architecture & UI/UX Agents write `docs/factory/ARCHITECTURE.md` and `UI_UX_SPEC.md`.
4. `assignment` — Tasks scheduled to ready queue by priority and dependencies.
5. `implementation` — `frontend`, `backend`, `database`, `mobile`, `ai_ml` execute in isolated Git worktrees (`factory/<task-id>`) or pause cleanly as `awaiting_agent` for Antigravity IDE coding.
6. `integration` — Verified, clean worktrees merge via `integrate` (`git merge --no-ff`).
7. `testing` — QA Agent runs `lint`, `typecheck`, `test`, `build` gates via `safeSpawn`.
8. `security_review` — Security Agent scans filenames, file contents, and dependency audits.
9. `quality_review` — Code Review Agent runs `git diff --check` and Ponytail/pstack review.
10. `release_candidate` — DevOps Agent updates `RUNBOOK.md` and prepares release candidate.
11. `human_approval` — Explicit `approve` required on clean verified HEAD + unchanged config hash.
12. `deployment` — Intentionally manual / owner-triggered outside automatic pipeline.
13. `verification` — Documentation Agent updates `docs/factory/STATUS.md` and release record.

## SQLite Persistence Schema (`src/db.mjs`)

- `projects`: Registered project paths, detected adapters, config snapshot, config SHA-256 hash.
- `pipelines`: Goal, active stage, lifecycle status.
- `tasks`: DAG nodes (`depends_on_json`), assigned `agent_role`, `stage`, `status`, `attempts`, `max_retries`, `lease_owner`, `worktree`, `branch`, `last_error`, `verification_json`, `approval_json`.
- `task_history`: Audit trail of state transitions.
- `execution_logs`: Redacted operational logs.
- `gate_runs`: Per-check outcomes (`PASS`/`FAIL`/`NOT VERIFIED`) and measurable pass-rate metrics.
- `security_findings` & `review_findings`: Open and resolved findings.
- `releases` & `approvals`: Release candidate history and human sign-off decisions.
- `agent_runs`: Per-agent invocation records and provider provenance.

## Execution Boundary & Parallelism

- Independent tasks run concurrently up to configured `concurrency` (default 3) only when all `depends_on` tasks are in `completed`, `verified`, or `approved`.
- Code-modifying tasks use dedicated Git worktrees under `.factory/worktrees/<task-id>` on branch `factory/<task-id>` so parallel agents cannot overwrite each other's working tree.
- Subprocesses run via `safeSpawn()` in `src/security.mjs` with `assertInsideRoot()` path jailing and `redactSecrets()` scrubbing.

