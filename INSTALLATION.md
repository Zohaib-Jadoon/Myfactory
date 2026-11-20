# Installation Guide (`v1.0.0`)

Install Myfactory globally across Antigravity IDE and Cursor IDE, or into individual repositories without touching IDE processes.

## Prerequisites

- **OS:** Windows 11 (PowerShell 5.1+) or Ubuntu/Linux (`bash`)
- **Node.js:** `>= 22.5` (tested on Node `24.21.0`; uses built-in `node:sqlite`, zero external `npm install`)
- **Git:** `git` CLI in `PATH`

## Windows 11 Setup (`Setup.ps1` / `Install-Factory.ps1`)

### Global + Auto-Install Missing pstack & Ponytail

```powershell
git clone https://github.com/Zohaib-Jadoon/Myfactory.git C:\Tools\Myfactory
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Tools\Myfactory\installer\Setup.ps1 -Scope Global
```

### Offline Install (Bundled Skills Only)

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Tools\Myfactory\installer\Setup.ps1 -Scope Both -ProjectPath "C:\Projects\MyApp" -Offline
```

## Ubuntu / Linux Setup (`installer/install.sh`)

```bash
git clone https://github.com/Zohaib-Jadoon/Myfactory.git ~/tools/Myfactory
bash ~/tools/Myfactory/installer/install.sh --scope global
# Or workspace + offline:
bash ~/tools/Myfactory/installer/install.sh --scope both --project . --offline
```

Ensure `~/.local/bin` is in `PATH` to run `factory` directly.

## Initializing a Project

```bash
factory init . --profile auto          # New or existing project, stack detection + memory link
factory init . --dry-run               # Preview profile, gates, and skill suggestions without writes
factory init . --factory-only          # Keep existing Git repo clean (.factory/ only, gitignored)
```

## Installed Paths

- **Antigravity Global:** `~/.gemini/config/skills/`, `~/.gemini/config/rules/`, `~/.gemini/config/agents/`, `~/.gemini/workflows/`, `~/.agents/workflows/`, `~/.gemini/GEMINI.md`
- **Cursor Global:** `~/.cursor/skills/`, `~/.cursor/rules/*.mdc`, `~/.cursor/agents/` *(never touches `~/.cursor/skills-cursor/`)*
- **Factory CLI & Global Memory:** `~/.gemini/factory-home/`, `~/.local/bin/factory` (`factory.cmd`), `~/.gemini/factory/factory.db`, `~/.gemini/factory/memory/global-memory.db`
