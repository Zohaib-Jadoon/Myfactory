# Google Antigravity IDE Integration

Myfactory integrates natively with Antigravity discovery conventions across global (`~/.gemini/`) and project (`.agents/`, `.agent/`) directories.

## Discovery Layout

| Artifact Type | Project Path | Global Path | Trigger / Frontmatter |
|---|---|---|---|
| Specialist Subagents (`60`) | `.agents/agents/<id>/agent.md` | `~/.gemini/config/agents/<id>/agent.md` | `name`, `description`, `category`, `legacy_role`, `readonly`, `stacks`, `skills` |
| Factory & Engineering Skills | `.agents/skills/<name>/SKILL.md` | `~/.gemini/config/skills/<name>/SKILL.md` | `name`, `description` (progressive load; `references/` lazy) |
| Conditional & Global Rules | `.agents/rules/*.md` | `~/.gemini/config/rules/*.md` | `trigger: always_on`, `trigger: glob` (`globs:`), `trigger: model_decision` |
| Slash Workflows (`15`) | `.agents/workflows/factory-*.md` | `~/.gemini/workflows/` & `~/.agents/workflows/` | `description`, `$ARGUMENTS` |

## Token-Conscious Configuration

- Only `.agents/rules/factory-quality.md` uses `trigger: always_on`.
- Conditional domain rules (`frontend-standards.md`, `database-migrations.md`, `biometric-privacy.md`, `iis-windows-deploy.md`, `game-engineering.md`) load strictly on matching files or model decisions.
- Portable rules and workflows contain **no hardcoded per-user paths**.
- Myfactory scripts **never close or restart** Antigravity IDE; if newly installed skills do not appear immediately in an open IDE chat menu, mark them `PENDING MANUAL RESTART`.
