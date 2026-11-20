# Smart Deployment Advisor (`src/deployment-advisor.mjs`)

Evaluates practical hosting strategies using detected infrastructure, project profile, verified deployment memory lessons, and rollback simplicity — preferring existing working hosting over unnecessary migrations or Kubernetes overhead.

## Supported Targets

`vercel`, `render`, `koyeb`, `github-actions`, `windows-iis`, `docker`, `windows-server`, `linux-vps`, `expo-eas-apk`, `electron-installer`, `game-export`.

## Evaluation Criteria

Every recommendation evaluates: existing infrastructure (`vercel.json`, `render.yaml`, `web.config`, `Dockerfile`, `eas.json`, `.github/workflows/`), compatibility, cost, engineering effort, operational complexity, repeatability, security, performance, rollback simplicity, maintenance burden, vendor lock-in, and expected scale.

## Target-Specific Guardrails

- **Windows IIS:** Back up site & `web.config`, verify T-SQL backups first, stage via PowerShell without stopping unrelated app pools or IDEs.
- **Mobile (Expo / Flutter):** Separate internal preview APK builds from store-signed release artifacts requiring human approval.
- **Desktop (Electron / Tauri):** Require packaged binary cold-startup verification (`NOT VERIFIED` if tested only in dev server mode).
- **Games (Unity / Unreal / Godot):** Verify simulation determinism, frame budgets, and exported build startup cleanly.

```bash
factory deploy advise .
factory deploy plan . --target windows-iis
```
