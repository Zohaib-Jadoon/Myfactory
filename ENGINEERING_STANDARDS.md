# Engineering Standards Library

Detailed technical playbooks live inside progressive skills under `.agents/skills/eng-*/references/playbook.md` rather than always-active rule prompts, preserving context budget until relevant.

## Bundled Engineering Playbooks (`10` Domains)

| Skill | Domain Scope | Lazy Playbook |
|---|---|---|
| `eng-architecture` | Modularity, state machines, versioned APIs, monorepos, ADRs | `.agents/skills/eng-architecture/references/playbook.md` |
| `eng-frontend` | React 19, Next.js 14-16 App Router, TypeScript strictness, WCAG 2.2 AA, XSS hygiene | `.agents/skills/eng-frontend/references/playbook.md` |
| `eng-backend` | REST DTO validation, RBAC, multi-tenancy, transactions, idempotency, retries | `.agents/skills/eng-backend/references/playbook.md` |
| `eng-databases` | PostgreSQL, Neon, Prisma `migrate deploy`, SQL Server T-SQL, rollback safety | `.agents/skills/eng-databases/references/playbook.md` |
| `eng-mobile` | Expo, React Native, Flutter permissions, SecureStore, offline queue, APK gates | `.agents/skills/eng-mobile/references/playbook.md` |
| `eng-desktop` | Electron `contextIsolation`, IPC preload guards, packaged executable startup | `.agents/skills/eng-desktop/references/playbook.md` |
| `eng-ai-biometrics` | Face/liveness FAR/FRR evals, OS vs external biometric separation, PII protection | `.agents/skills/eng-ai-biometrics/references/playbook.md` |
| `eng-games` | Unity C#, Unreal C++, Godot 4 deterministic fixed loops, frame budgets, exports | `.agents/skills/eng-games/references/playbook.md` |
| `eng-quality` | Unit, integration, contract, E2E, secret scans, honest `NOT VERIFIED` reporting | `.agents/skills/eng-quality/references/playbook.md` |
| `eng-deployment` | Platform simplicity, pre-flight checklists, health probes, rollback verification | `.agents/skills/eng-deployment/references/playbook.md` |

## Context-Sensitive `pstack` & `Ponytail` Scaling

- **`FAST` mode:** Lightweight `pstack` root-cause focus + `Ponytail lite` minimal edit.
- **`STANDARD` mode:** `pstack` data-shape-first + `Ponytail full` ladder (YAGNI, helper reuse, stdlib-first).
- **`DEEP` / `RELEASE` mode:** Full `pstack` architecture rigor, isolated Git worktrees, `Ponytail full`, and independent `factory review .` + `factory verify .`.
