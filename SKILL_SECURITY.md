# Skill Security & Provenance (`src/skills-engine.mjs`)

External skills from `skills.sh` or public GitHub repositories are treated as **untrusted code and prompts** until inspected.

## Pre-Install Security Inspection (`inspectSkillSecurity`)

Every local path, bundled skill, or cloned `owner/repo@skill` stage directory is hashed and scanned across `SKILL.md` and all script extensions (`.sh`, `.bash`, `.ps1`, `.psm1`, `.cmd`, `.bat`, `.mjs`, `.js`, `.cjs`, `.ts`, `.py`) **without executing any install scripts**:

- **`remote-pipe-exec` (`critical`):** Blocks `curl | bash`, `wget | sh`, and PowerShell `Invoke-Expression` remote downloads.
- **`destructive-delete` (`critical`):** Blocks `rm -rf` or recursive `Remove-Item` against `/`, `~`, or `$HOME`.
- **`ide-process-kill` (`critical`):** Blocks `taskkill`, `Stop-Process`, `pkill`, or `killall` targeting Antigravity or Cursor.
- **`credential-exfiltration` (`critical`):** Blocks scripts pairing `.ssh`, `.aws`, `.env`, or `FACTORY_DB_PATH` reads with outbound HTTP tools.
- **`prompt-injection-override` (`high`):** Blocks prompt instructions attempting to bypass approval gates, secret scans, or verification states.
- **Secret Scan (`critical`/`high`):** Runs `scanSecrets()` across all skill files.

Skills with any `critical` or `high` finding return `safe: false` and are rejected before copying any file into workspace or global IDE folders.

## Allowlist, Approval & Lockfiles

- Known reviewed skills live in [`src/skill-allowlist.json`](src/skill-allowlist.json).
- Unallowlisted external skills require explicit `--approve` (`factory skills install <spec> --approve`).
- Duplicate installs are rejected by default (`--overwrite` required).
- Approved installs record SHA-256 checksums (over sorted relative paths + file contents), Git commit SHAs when cloned, licenses, and target paths in SQLite (`skill_registry`) and `.factory/skills-lock.json`.
- `factory skills check .` re-computes directory SHA-256 digests and flags tampered skills (`MODIFIED_HASH`) or missing paths (`MISSING`).

```bash
factory skills inspect ./candidate-skill
factory skills install ./candidate-skill --approve
factory skills check .
```
