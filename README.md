# Myfactory — Universal AI Software Factory for Google Antigravity IDE (`v0.2.0`)

**GitHub Source:** https://github.com/Zohaib-Jadoon/Myfactory

A reusable, SQLite-backed, 14-agent software factory designed to run **inside and alongside Google Antigravity IDE on Windows 11** without ever closing, restarting, or modifying the IDE.

## Install from GitHub (Any Windows PC or Workspace)

Open **Antigravity integrated PowerShell terminal**:

```powershell
git clone https://github.com/Zohaib-Jadoon/Myfactory.git C:\Tools\Myfactory
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Tools\Myfactory\installer\Setup.ps1 -ProjectPath "C:\Projects\MyApp" -Scope Both -InstallExternalSkills
```

- Use `-Scope Global` (no `-ProjectPath`) to install globally for all projects on your PC (`~/.gemini/config/skills`, `~/.gemini/workflows`, `~/.gemini/config/rules`, `~/.gemini/GEMINI.md`, `~/.gemini/factory-home`, and `factory` CLI on `PATH`).
- Use `-Scope Both -ProjectPath "C:\Projects\MyApp"` to also initialize `.agent/`, `.agents/`, and `.factory/` inside a specific repository while preserving existing files.

### Reusable Antigravity Instruction

> Install Myfactory from https://github.com/Zohaib-Jadoon/Myfactory.git into this workspace. Read README.md and AGENTS.md, run `installer\Setup.ps1`, initialize `.agent`, `.agents`, and `.factory/`, verify `pstack` (`poteto-mode`) and `Ponytail` integration, run `npm test` and `factory doctor`, preserve existing files, and never close or restart Antigravity IDE.

## Capabilities

- **SQLite Persistence (`node:sqlite`, zero external dependencies):** Persists registered projects, 13-stage pipelines, DAG tasks, execution logs, quality gate runs, security findings, code reviews, release candidates, and human approvals in `%USERPROFILE%\.gemini\factory\factory.db` (configurable via `FACTORY_DB_PATH`).
- **14 Specialized Executable Agent Roles:** `director`, `product_manager`, `architect`, `ui_ux`, `frontend`, `backend`, `database`, `mobile`, `ai_ml`, `security`, `qa`, `code_review`, `devops`, and `documentation`.
- **Dependency-Aware DAG Orchestration:** Bounded parallel execution, isolated Git worktrees, retry handling, task cancellation, failure recovery (`resume`), and post-verification worktree integration (`integrate`).
- **Universal Project Adapter System:** Detects Next.js, React, NestJS, Node.js, Python, .NET, Flutter, Expo/React Native, PostgreSQL, SQL Server, Docker, Desktop, AI/ML, and Monorepo layouts.
- **Native Antigravity + pstack + Ponytail Integration:** Slash workflows (`/factory-init` through `/factory-resume`) and global `always_on` rules automatically applying **pstack** (`poteto-mode`, MIT) and **Ponytail** (`ponytail full`, MIT).
- **Local Read-Only Control Dashboard:** Loopback-bound (`127.0.0.1`) HTTP UI and JSON API (`/api/overview`, `/api/projects`, `/api/health`) backed directly by persisted SQLite state.

## Quick Start

```powershell
factory init .
factory plan . --goal "Build REST API with auth and automated tests"
factory run .
factory status .
factory verify .
factory review .
factory release . --version "0.1.0-rc.1"
factory serve . --port 4177
```

## Antigravity Slash Workflows

| Workflow | Purpose |
|---|---|
| `/factory-init` | Initialize `.factory/config.json`, detect adapters, register SQLite |
| `/factory-plan` | Analyze requirements and create 14-agent DAG task plan |
| `/factory-build` | Execute plan with isolated Git worktrees, `pstack`, and `Ponytail` |
| `/factory-status` | Inspect persisted tasks, agents, blockers, and gate reports |
| `/factory-test` | Run configured quality gates (`lint`, `typecheck`, `test`, `build`, secrets) |
| `/factory-review` | Run Security Agent and Code Review Agent audits |
| `/factory-fix` | Inspect failed tasks/findings and retry after root-cause fixes |
| `/factory-release` | Validate release candidate and request human approval |
| `/factory-resume` | Recover interrupted/failed tasks without restarting completed work |
| `/factory-verify` | Alias for `/factory-test` |
| `/factory-security` | Alias for security-focused `/factory-review` |

## Safety & Truthfulness Guarantees

- Never closes, restarts, or modifies Antigravity IDE processes.
- Never auto-pushes, auto-merges without verification, deploys to production, or builds signed APKs without explicit human approval.
- Marks missing runtimes, unconfigured gates, or unauthenticated external CLI providers as `NOT VERIFIED` or `BLOCKED`—never fabricated `PASS`.
