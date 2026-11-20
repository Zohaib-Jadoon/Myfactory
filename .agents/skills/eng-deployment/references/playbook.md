# Deployment & Release Engineering Playbook

## 1. Platform Selection & Simplicity
- **Web Fullstack / Next.js:** Vercel (zero-config SSR/Edge) or Render/Docker when long-lived WebSockets/background workers share one origin.
- **NestJS / Python / IoT Backends:** Render, Koyeb, Docker on Linux VPS, or Windows Server when integrating internal SQL Server networks.
- **Windows / Classic ASP / MSSQL:** IIS + PowerShell artifact staging (`web.config` transform, backup zip, offline maintenance window, verified rollback swap) without disturbing unrelated app pools or local IDEs.

## 2. Pre-Flight Release Checklist
1. Clean Git revision, passing lint/typecheck/unit/integration/build gates (`factory verify .`).
2. Zero unresolved critical/high security findings or tracked secrets (`factory review .`).
3. Database backup verified BEFORE schema migrations (`migrate deploy`).
4. Artifact build tested (`next build`, `flutter build apk --debug`, or packaged desktop startup check).
5. Health probe verified after staging start (`GET /health` -> 200).
6. Rollback command rehearsed (`git revert` / IIS zip swap / DB snapshot restore).
7. Explicit human approval (`factory approve`) recorded before any live deployment or signed release publish.
