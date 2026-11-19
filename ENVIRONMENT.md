# Environment Configuration

Store only environment variable **NAMES** in documentation and `.env.example` files. Never store live secret values in source control, SQLite logs, or Markdown files.

## Core Factory Variables

| Variable Name | Default | Purpose |
|---|---|---|
| `FACTORY_DB_PATH` | `%USERPROFILE%\.gemini\factory\factory.db` | Optional override for the SQLite control plane database path |
| `CI` | `true` | Forced during `factory verify` quality gate execution |

## Optional External Provider CLI Keys

Only needed if you intentionally invoke external CLI coding agents outside Antigravity IDE's built-in session:

| Variable Name | Provider | Required For |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude Code CLI (`claude`) | Headless Claude CLI runs (if not using interactive CLI auth) |
| `OPENAI_API_KEY` | OpenAI Codex CLI (`codex`) | Headless Codex CLI runs (if not using interactive CLI auth) |
| `GEMINI_API_KEY` | Gemini CLI (`gemini`) | Headless Gemini CLI runs (if not using Google OAuth auth) |

