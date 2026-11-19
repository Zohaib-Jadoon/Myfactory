# Security & Execution Boundaries

## Core Safeguards

1. **IDE Protection:** No factory script, skill, or workflow may execute `taskkill`, `Stop-Process`, or restart/modify Google Antigravity IDE processes or binaries.
2. **Project Path Jailing (`assertInsideRoot`):** Every `check.cwd` and worktree target is canonicalized (`realpathSync`) and verified to remain strictly inside the target repository/worktree root. Traversal (`../`) and escaping symlinks are rejected.
3. **Untrusted Repository Policy Guard (`enforceSafetyPolicy`):** Project-level `.factory/config.json` cannot disable `human_approval_required: true`, enable `automatic_deployment: true`, or set `allow_outside_root: true`.
4. **Secret Detection & Redaction (`scanSecrets`, `redactSecrets`):**
   - Scans tracked filenames and workspace file contents for private keys, AWS/GitHub/Google/Stripe/Slack/OpenAI/Anthropic tokens, and connection-string passwords.
   - Automatically scrubs matched patterns to `[REDACTED*]` before writing to console output, SQLite `execution_logs`, `task_history`, `gate_runs`, or `releases`.
5. **Safe Windows Subprocess Execution (`safeSpawn`):** Invokes Windows `.cmd` shims (`npm`, `npx`, `flutter`, etc.) via `cmd.exe /d /s /c` with explicit argument quoting and `shell: false`, avoiding Node `DEP0190` unescaped shell argument concatenation.
6. **Read-Only Dashboard:** Control Dashboard binds exclusively to `127.0.0.1`, accepts `GET` only (`405` on all mutations), sets `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`, and HTML-escapes every dynamic field.
7. **Human Approval & Revision Binding:** `factory approve` requires a clean working tree (`git status --porcelain` empty), matching `HEAD` revision, and unchanged `.factory/config.json` SHA-256 hash since the passing verification run. Never auto-pushes, auto-deploys, or generates signed APKs.

