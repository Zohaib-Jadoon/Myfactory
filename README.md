# Myfactory — Universal AI Software Factory (`v0.2.0`)

**GitHub:** https://github.com/Zohaib-Jadoon/Myfactory

A reusable, zero-dependency, SQLite-backed software factory built for **Google Antigravity IDE** and **Cursor IDE** on Windows 11 (with cross-platform Node CLI support). It combines a 14-agent DAG orchestrator, isolated Git worktrees, security and quality gates, a local Control Room dashboard, and automatic **pstack** (`/poteto-mode`) + **Ponytail** (`/ponytail`) engineering discipline.

---

## Prerequisites

- **OS:** Windows 11 (PowerShell 5.1+)
- **Node.js:** `>=22.5` (tested on Node 24; uses built-in `node:sqlite`, zero `npm install` needed)
- **Git:** `git` CLI in `PATH`
- **IDE:** Google Antigravity IDE and/or Cursor IDE

---

## Quick Install

### Option A — Give This Repo to Your AI Agent (Antigravity or Cursor)

Open **Antigravity** or **Cursor** inside any project folder and paste this prompt:

```text
Install Myfactory from https://github.com/Zohaib-Jadoon/Myfactory.git.
Clone it to C:\Tools\Myfactory (or pull if it already exists), inspect README.md and AGENTS.md, then run:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Tools\Myfactory\installer\Setup.ps1 -ProjectPath "." -Scope Both -UpdateFactory
Verify `npm test` in C:\Tools\Myfactory and `factory doctor "."`. Preserve all existing project files and never close or restart Antigravity or Cursor IDE.
```

### Option B — Manual PowerShell Install

**1. Install once globally for all projects on your PC (Antigravity + Cursor + `factory` CLI + auto-installs missing pstack & Ponytail):**

```powershell
git clone https://github.com/Zohaib-Jadoon/Myfactory.git C:\Tools\Myfactory
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Tools\Myfactory\installer\Setup.ps1 -Scope Global
```

**2. Install globally AND initialize a specific project workspace at the same time:**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Tools\Myfactory\installer\Setup.ps1 -ProjectPath "C:\Projects\MyApp" -Scope Both
```

`Setup.ps1` and `factory init .` automatically detect if **pstack** (`https://github.com/backnotprop/pstack.git`, MIT) or **Ponytail** (`https://github.com/DietrichGebert/ponytail.git`, MIT) are missing and install them into both Antigravity and Cursor without overwriting existing skills. For offline installs, pass `-SkipExternalSkills` (or `factory init . --skip-external`).

**3. Update an existing local installation later:**

```powershell
git -C C:\Tools\Myfactory pull --ff-only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Tools\Myfactory\installer\Setup.ps1 -Scope Global -UpdateFactory
```

*(Ensure `%USERPROFILE%\.local\bin` is in your `PATH` to run `factory` directly; otherwise use `node "%USERPROFILE%\.gemini\factory-home\bin\factory.mjs"`.)*

---

## How to Use in Any Project

### Step 1 — Initialize a Project in One Command

From the root of **any** new or existing project folder:

```powershell
factory init .
```

This single command preserves existing files while scaffolding missing:
- `.agent/` — workspace factory docs (`README.md`, `FACTORY_MEMORY.md`, `FACTORY_ARCHITECTURE.md`, `QUALITY_GATES.md`, `SECURITY.md`, `ENVIRONMENT.md`, `SKILLS_REGISTRY.md`)
- `.agents/` — Antigravity skills, `/factory-*` workflows, and `factory-quality.md`
- `.cursor/` — Cursor `.cursor/rules/factory-quality.mdc` (`alwaysApply: true`) and `.cursor/skills/factory-*`
- `.factory/` — auto-detected `config.json`, `tasks/`, `reports/`, and `.gitignore` (`*`), plus SQLite project registration

> **Keep an existing Git repository untouched?** Pass `factory init . --factory-only` to create only `.factory/` (ignored by `.factory/.gitignore`) while relying on your global Antigravity/Cursor skills and rules.

### Step 2 — Run via Prompt Inside Antigravity or Cursor

**For a new app or feature:**

```text
Run the software factory (/factory-init, /factory-plan, /factory-build, /factory-test, /factory-review, /factory-release) using /poteto-mode and /ponytail full for:

<DESCRIBE YOUR APP OR FEATURE>

Work in isolated Git worktrees, write and run real automated tests, block on any failed or missing gates, never close the IDE, and stop for my approval before pushing or deploying.
```

**For an existing codebase:**

```text
Inspect this existing repository first (git status, manifests, tests, migrations, .env.example) without altering unrelated code or production data.
Run `factory init .` if needed and `factory verify "."` for a baseline.
Use /factory-plan, /factory-build, /poteto-mode, and /ponytail full to implement the task below in an isolated Git worktree (`factory worktree "." --id <id>`), add regression tests, verify (`factory verify "." --id <id>`), run `factory review "."`, and merge only after gates pass on a clean commit.

TASK: <DESCRIBE THE FIX, FEATURE, OR REFACTOR>
```

### Step 3 — Slash Commands (`/factory-*`, `/poteto-mode`, `/ponytail`)

| Command | Purpose |
|---|---|
| `/factory-init` | Initialize `.agent/`, `.agents/`, `.cursor/`, `.factory/`, and SQLite tracking |
| `/factory-plan` | Analyze requirements and create a 14-agent DAG task plan |
| `/factory-build` | Execute the plan with isolated Git worktrees, `pstack`, and `Ponytail` |
| `/factory-status` | Show persisted tasks, agent assignments, blockers, and gate pass rates |
| `/factory-test` | Run configured quality gates (`lint`, `typecheck`, `test`, `build`, secrets) |
| `/factory-review` | Run Security Agent and Code Review Agent audits |
| `/factory-fix` | Inspect failed tasks/findings, apply root-cause fixes, and retry |
| `/factory-release` | Validate a release candidate and request human approval |
| `/factory-resume` | Recover interrupted or failed tasks without restarting completed work |
| `/factory-verify` | Alias for `/factory-test` |
| `/factory-security` | Security-focused `/factory-review` |
| `/poteto-mode` | pstack deep engineering, foundational thinking, and verification rigor |
| `/ponytail` | Minimal complete diff, YAGNI, stdlib-first, zero bloat (`lite\|full\|ultra`) |

### Step 4 — Launch the Control Room Dashboard

```powershell
factory serve . --port 4177
```

Open `http://127.0.0.1:4177` for the read-only local dashboard backed by SQLite (JSON APIs: `/api/overview`, `/api/projects`, `/api/health`).

---

## CLI Reference

```powershell
factory doctor [project]                  # Check Node, SQLite, Git, runtimes, Antigravity & Cursor skills
factory init [project] [--factory-only]   # Scaffold project setup, detect adapters, register SQLite
factory plan [project] --goal "..."       # Generate 13-stage pipeline and DAG tasks
factory create [project] --name "..." --criteria "..." [--role backend]
factory run [project] [--concurrency 3]   # Execute ready DAG tasks in dependency order
factory status [project]                  # Show pipeline, task states, blockers, and approvals
factory list [project]                    # List tasks
factory worktree [project] --id TASK_ID   # Create isolated Git worktree (factory/<id>)
factory verify [project] [--id TASK_ID]   # Run secret scan + configured quality gates
factory integrate [project] --id TASK_ID  # Merge verified, clean worktree branch (no push)
factory review [project] [--id TASK_ID]   # Run Security Agent + Code Review Agent
factory fix [project] [--id TASK_ID] [--retry]
factory release [project] --version "0.1.0-rc.1"
factory approve [project] --id TASK_ID --by "Owner"
factory resume [project]                  # Recover interrupted/failed tasks from SQLite
factory cancel [project] --id TASK_ID [--reason "..."]
factory logs [project] [--limit 50]       # Read redacted execution logs
factory agents                            # List all 14 factory agent roles
factory serve [project] [--port 4177]     # Start loopback-only read-only dashboard
```

---

## Where Files Are Installed

| Scope | Target | Installed Paths |
|---|---|---|
| **Antigravity (Global)** | Skills, workflows, rules | `~/.gemini/config/skills/`, `~/.gemini/workflows/`, `~/.agents/workflows/`, `~/.gemini/config/rules/factory-quality.md`, `~/.gemini/GEMINI.md`, `~/.agents/pstack-models.md` |
| **Cursor (Global)** | Skills & always-applied rules | `~/.cursor/skills/`, `~/.cursor/rules/factory-quality.mdc`, `~/.cursor/rules/pstack-models.mdc` *(never touches `~/.cursor/skills-cursor/`)* |
| **Global CLI & DB** | Runtime, shim & SQLite | `~/.gemini/factory-home/`, `~/.local/bin/factory.cmd`, `~/.gemini/factory/factory.db` |
| **Workspace** | Per-repo setup | `.agent/`, `.agents/`, `.cursor/`, `.factory/` |

---

## Architecture, Agents & Supported Stacks

- **14 Agent Roles:** `director`, `product_manager`, `architect`, `ui_ux`, `frontend`, `backend`, `database`, `mobile`, `ai_ml`, `security`, `qa`, `code_review`, `devops`, `documentation`.
- **13-Stage Pipeline:** `requirements` → `planning` → `architecture` → `assignment` → `implementation` → `integration` → `testing` → `security_review` → `quality_review` → `release_candidate` → `human_approval` → `deployment` → `verification`.
- **Auto-Detected Stack Adapters:** Next.js, React, NestJS, Node.js, Python, .NET, Flutter, Expo / React Native, PostgreSQL, SQL Server, Docker, Desktop (Electron / Tauri), AI/ML, and Monorepos (`frontend/`, `backend/`, `api/`, `apps/*`, `services/*`, `packages/*`).

---

## Safety, Security & Honest Limits

- Never closes, restarts, or modifies Antigravity or Cursor IDE processes. (If newly added slash skills do not appear immediately in an open chat UI, reload the IDE manually when convenient.)
- Never pushes, merges unverified work, deploys to production, runs production migrations, or signs APKs without explicit human approval.
- Enforces path traversal jailing (`assertInsideRoot`), secret filename & content scanning (`scanSecrets`), output/log secret redaction (`redactSecrets`), and non-overridable policy defaults (`automatic_deployment: false`, `human_approval_required: true`).
- Marks missing runtimes, empty gate configs, or unauthenticated external CLIs as `NOT VERIFIED` or `BLOCKED`—never fabricated `PASS` or 99.99% guarantees.

---

## Documentation

- [FACTORY_ARCHITECTURE.md](FACTORY_ARCHITECTURE.md) — SQLite schema, 14 agents, DAG scheduler, and worktree boundaries
- [QUALITY_GATES.md](QUALITY_GATES.md) — Verification states (`PASS` / `FAIL` / `NOT VERIFIED`) and gate metrics
- [SECURITY.md](SECURITY.md) — Permissions, secret scanning, redaction, and path jailing
- [ENVIRONMENT.md](ENVIRONMENT.md) — Supported environment variable names (no secret values)
- [SKILLS_REGISTRY.md](SKILLS_REGISTRY.md) — Installed skills, upstream `pstack` & `Ponytail` revisions, MIT licenses
- [FACTORY_MEMORY.md](FACTORY_MEMORY.md) — Implementation phases, incident log, and known gaps
- [CHANGELOG.md](CHANGELOG.md) — Version history
