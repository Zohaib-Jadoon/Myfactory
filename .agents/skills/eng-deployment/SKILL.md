---
name: eng-deployment
description: Deployment and release engineering standards for CI/CD, Vercel, Render, Koyeb, Windows IIS, Docker, health checks, rollback, and disaster recovery.
---
# Engineering Standards — Deployment & Release

Load `references/playbook.md` when selecting hosting targets, configuring CI/CD, planning IIS/Docker rollouts, or authoring rollback runbooks.

## Core Checklist
1. Favor the simplest platform matching existing project requirements; do not introduce Kubernetes or hosting migrations without evidence.
2. Separate reproducible build/artifact verification from live production promotion (always require explicit human approval).
3. Include health probe endpoints (`/health`), env var checklists (names only in `.env.example`), DB backup/migration order, and single-command rollback.
4. Consult Global Memory (`deployment-lessons`) so past verified IIS/platform fixes inform current deployment plans.
