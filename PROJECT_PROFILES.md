# Reusable Engineering Project Profiles (`src/profiles.mjs`)

Project profiles guide initial specialist selection, skill recommendations, quality guardrails, and deployment advice **without** forcing migrations on existing codebases.

| CLI ID | Profile | Preferred Technologies / Priorities |
|---|---|---|
| `web` | Profile A — SaaS / Web | Next.js 14-16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, NestJS 11, PostgreSQL/Neon, Prisma, REST, RBAC, Vercel/Render |
| `mobile` | Profile B — Mobile Apps | Expo/React Native, Flutter, Android APK/release builds, GPS, camera permissions, OS biometrics, offline queues; separates emulator vs device hardware |
| `ai` | Profile C — AI & Biometrics | Face recognition/verification, liveness, anti-spoofing, FAR/FRR evals, enrollment, geofencing; separates OS biometrics vs external readers |
| `iot` | Profile D — IoT & Fleet | GPS tracker protocols, WebSockets/MQTT, ignition events, geofences, historical routes, OpenStreetMap, device auth; never fakes live vehicle status |
| `legacy` | Profile E — Windows & SQL | SQL Server, T-SQL, Classic ASP, IIS, PowerShell, Windows Services; preserves live production schemas & rollback |
| `desktop` | Desktop Applications | Electron/Tauri, preload IPC isolation, NSIS/MSI installers, packaged cold-startup verification |
| `enterprise` | Profile F — HR / ERP / Health | Multi-tenant RBAC, attendance/shifts, payroll, scheduling, clinical workflows, financial audit logs |
| `game` | Profile G — Games | Unity/C#, Unreal/C++, Godot/GDScript, fixed-timestep loops, asset pipelines, multiplayer, frame/memory budgets |
| `generic` | Profile H — Generic / Existing | Inspects repository stack first; zero forced template or framework migrations |

## Commands

```bash
factory init . --profile auto      # Detects stack & picks closest profile cleanly
factory init . --profile legacy    # Explicit profile selection
factory profile show .             # Inspect active profile and guardrails
factory profile set . web          # Persist manual profile override in SQLite
```
