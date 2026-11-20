# Cursor IDE Integration

Myfactory provides first-class Cursor IDE subagents, rules, and skills without touching Cursor's internal system skills directory.

## Discovery Layout

| Artifact Type | Project Path | Global Path | Frontmatter / Behavior |
|---|---|---|---|
| Custom Subagents (`60` + `pstack`) | `.cursor/agents/<id>.md` | `~/.cursor/agents/<id>.md` | `name`, concise `description`, `model: inherit`, `readonly: true\|false` |
| Project Rules | `.cursor/rules/*.mdc` | `~/.cursor/rules/*.mdc` | Always `.mdc`: `factory-quality.mdc` (`alwaysApply: true`), 5 conditional rules (`alwaysApply: false` + `globs:`/`description:`) |
| Agent Skills | `.cursor/skills/<name>/SKILL.md` | `~/.cursor/skills/<name>/SKILL.md` | Same progressive `SKILL.md` skills (`factory-*`, matching `eng-*`, `poteto-mode`, `ponytail`) |

## Safeguards

- Installers and `skills-engine.mjs` **never modify or write inside `~/.cursor/skills-cursor/`**.
- Never terminates or restarts Cursor processes.
- `factory doctor .` inspects `~/.cursor/skills`, `~/.cursor/rules/factory-quality.mdc`, subagent counts, and `cursor-ide` provider readiness.
