# Myfactory — Self-Improving Universal AI Software Factory (`v1.0.0`)

**Repository:** https://github.com/Zohaib-Jadoon/Myfactory

Zero-dependency (Node.js `>=22.5` + built-in `node:sqlite`), dual-IDE software engineering factory for **Google Antigravity IDE** and **Cursor IDE** on **Windows 11** and **Ubuntu/Linux**.

---

## Core Capabilities

- **60 Specialist Agents Across 9 Categories** with native `.agents/agents/<id>/agent.md` (Antigravity) and `.cursor/agents/<id>.md` (Cursor) adapters plus full backward compatibility for the 14 legacy orchestration roles.
- **Smart Agent Router & Context Budget Engine:** Routes tasks across `FAST`, `STANDARD`, `DEEP`, and `RELEASE` modes, keeping irrelevant domains out and reducing measured prompt payload bytes (`83.55%`–`97.73%` byte reduction measured on this repository across benchmark prompts).
- **Self-Improving 3-Level Memory (`src/memory.mjs`):** SQLite-backed Task (`.factory/tasks/<id>.memory.json`), Project (`.factory/memory/*.md`), and isolated Global (`~/.gemini/factory/memory/global-memory.db`) storage with explicit vs inferred preference gates, duplicate consolidation, sensitive/PII/biometric filtering, and AES-256-GCM encrypted export/import.
- **9 Project Profiles:** `web`, `mobile`, `ai`, `iot`, `legacy`, `desktop`, `enterprise`, `game`, and `generic` — guiding defaults without forcing migrations on existing codebases.
- **Skill Discovery & Security Scanner:** Searches local registry, curated catalog, and `npx skills` (`skills.sh` / GitHub); scans `SKILL.md` + scripts for remote pipe exec, `rm -rf`, IDE process kills, secret exfiltration, and prompt injection; verifies SHA-256 lockfiles (`.factory/skills-lock.json`).
- **Smart Deployment Advisor:** Evaluates Vercel, Render, Koyeb, GitHub Actions, Windows IIS, Docker, VPS, Expo/Flutter APK, Desktop installers, and Game exports while surfacing relevant past deployment memory lessons.
- **Safe Self-Updater & Project Sync:** `factory update` and `factory sync` verify payloads, protect dirty Git working trees, preserve user customizations, migrate SQLite schemas (`v1` -> `v2`), maintain backups/journals, and roll back automatically on failure.
- **Control Room Dashboard:** Loopback-only, read-only SQLite web UI (`factory serve . --port 4177`) with JSON APIs (`/api/overview`, `/api/projects`, `/api/health`, `/api/agents`, `/api/skills`, `/api/memory`, `/api/updates`, `/api/metrics`).

---

## Quick Install

### Option A — Windows 11 PowerShell

```powershell
git clone https://github.com/Zohaib-Jadoon/Myfactory.git C:\Tools\Myfactory
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Tools\Myfactory\installer\Setup.ps1 -Scope Global
```

Initialize a project at the same time (or pass `-Offline` to skip external GitHub cloning):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Tools\Myfactory\installer\Setup.ps1 -ProjectPath "C:\Projects\MyApp" -Scope Both
```

### Option B — Ubuntu / Linux

```bash
git clone https://github.com/Zohaib-Jadoon/Myfactory.git ~/tools/Myfactory
bash ~/tools/Myfactory/installer/install.sh --scope global
```

Both installers automatically install missing **pstack** (`backnotprop/pstack`, MIT) and **Ponytail** (`DietrichGebert/ponytail`, MIT) unless `-SkipExternalSkills` / `-Offline` / `--offline` is supplied, preserve existing files, never touch `~/.cursor/skills-cursor/`, and **never close or restart** Antigravity or Cursor IDE.

### Option C — AI Agent Setup Prompt (Antigravity / Cursor)

```text
Install Myfactory from https://github.com/Zohaib-Jadoon/Myfactory.git into C:\Tools\Myfactory (or pull latest if present), read README.md and AGENTS.md, run Setup.ps1 -ProjectPath "." -Scope Both -UpdateFactory (or installer/install.sh --scope both --project . on Linux), verify `npm test` and `factory doctor "."`, preserve all existing files, and never close or restart the IDE.
```

---

## Common Workflows & Examples

### Initialize New or Existing Projects
```bash
factory init . --dry-run               # Preview detected stack, profile, gates, skills
factory init . --profile auto          # Initialize with auto-detected profile & global memory link
factory init . --factory-only          # Existing repo minimal mode (.factory/ only)
factory profile set . web              # Override saved profile in SQLite
```

### Route Agents, Manage Context & Discover Skills
```bash
factory agents list --category engineering
factory agents explain . --request "Fix NestJS authentication token guard bug"
factory context inspect . --request "Add Stripe webhook"
factory context benchmark .

factory skills recommend .
factory skills search "nextjs performance" [--offline]
factory skills inspect ./local-skill
factory skills install vercel-labs/agent-skills@web-design-guidelines --approve
factory skills check .
```

### Learn, Approve & Reuse Knowledge Across Projects
```bash
# In Project A
factory learn . --from-feedback --statement "Keep dashboards uncluttered with responsive cards" --category ui-ux
factory memory review
factory memory approve --id <mem-id> --by "Owner"
factory reflect .

# Export / Import / Maintain Memory
factory memory export --file memory-backup.enc.json --passphrase "your-passphrase"
factory memory import memory-backup.enc.json --passphrase "your-passphrase"
factory memory consolidate
factory memory disable <id>
```

### Safe Updates & Project Sync
```bash
factory update --check
factory update --dry-run
factory update --yes
factory update --rollback
factory sync . --dry-run
factory sync .
```

### Deployment Advice & Gated Release
```bash
factory deploy advise .
factory deploy plan . --target render
factory verify .
factory review .
factory release . --version "1.0.0-rc.1"
factory approve . --id <task-id> --by "Owner"
factory serve . --port 4177
```

---

## Honest Guarantees & Limits

- **No Automatic Push / Deploy / Signed Builds:** `automatic_deployment: false` and `human_approval_required: true` cannot be overridden by target project configs.
- **No Fake Greens or Fabricated Tokens:** Empty gate configs or missing binaries return `NOT VERIFIED` (`ok: false`). Context benchmarks measure real file bytes; provider LLM tokens report `unavailable` unless real API usage metadata is supplied.
- **Documentation Index:** See [`FACTORY_ARCHITECTURE.md`](FACTORY_ARCHITECTURE.md), [`AGENT_REGISTRY.md`](AGENT_REGISTRY.md), [`AGENT_ROUTING.md`](AGENT_ROUTING.md), [`MEMORY_ARCHITECTURE.md`](MEMORY_ARCHITECTURE.md), [`LEARNING_ENGINE.md`](LEARNING_ENGINE.md), [`CONTEXT_OPTIMIZATION.md`](CONTEXT_OPTIMIZATION.md), [`PROJECT_PROFILES.md`](PROJECT_PROFILES.md), [`SKILLS_REGISTRY.md`](SKILLS_REGISTRY.md), [`SKILL_SECURITY.md`](SKILL_SECURITY.md), [`ENGINEERING_STANDARDS.md`](ENGINEERING_STANDARDS.md), [`DEPLOYMENT_STRATEGIES.md`](DEPLOYMENT_STRATEGIES.md), [`UPDATE_SYSTEM.md`](UPDATE_SYSTEM.md), [`ANTIGRAVITY_INTEGRATION.md`](ANTIGRAVITY_INTEGRATION.md), [`CURSOR_INTEGRATION.md`](CURSOR_INTEGRATION.md), [`INSTALLATION.md`](INSTALLATION.md), [`MIGRATION_GUIDE.md`](MIGRATION_GUIDE.md), [`TEST_REPORT.md`](TEST_REPORT.md), and [`RELEASE_NOTES.md`](RELEASE_NOTES.md).
