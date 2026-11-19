# Project Architecture Template

- **Stack & Adapters:** Run `factory init .` to detect adapters (`nextjs`, `react`, `nestjs`, `node`, `python`, `dotnet`, `flutter`, `expo`, `postgres`, `sqlserver`, `docker`, `ai_ml`, `monorepo`).
- **Execution Boundary:** Parallel tasks run in isolated Git worktrees (`.factory/worktrees/<task-id>`) and integrate only after passing quality gates.
