---
trigger: always_on
---
# Universal Software Factory — Global Quality, pstack & Ponytail Policy

Applies automatically across every project opened in Google Antigravity on this machine.

## 1. Automatic Engineering Modes
- **pstack (`/poteto-mode`):** For every coding, debugging, refactoring, or architecture task, apply `C:/Users/CP/.gemini/config/skills/poteto-mode/SKILL.md` principles: understand the full flow and data shape first, separate concurrent state (Git worktrees), fix root causes, verify against real artifacts (`principle-prove-it-works`), and keep prose/comments clean (`unslop`, `no-comments`).
- **Ponytail (`/ponytail full`):** For every code change, climb Ponytail's ladder (`C:/Users/CP/.gemini/config/skills/ponytail/SKILL.md`): YAGNI, reuse existing helpers, prefer stdlib and native platform features, avoid speculative abstractions/dependencies, and ship the smallest complete diff—never trading away validation, security, accessibility, or tests.

## 2. Factory Workflow & Release Integrity
- For nontrivial tasks, track work via the global `factory` CLI (`factory init`, `factory plan`, `factory run`, `factory verify`, `factory review`, `factory release`, `factory serve`).
- No false success claims: a green build is not proof of live production correctness. All blocking gates must have fresh evidence from the current clean revision; never bypass or edit tests to make them pass.
- Mark any missing runtime, unconfigured check, or manual/physical test as **NOT VERIFIED** or **BLOCKED**, never PASS.
- Never close, restart, reload, or terminate Antigravity IDE processes.
- Never push, merge without verification, deploy, overwrite databases, run production migrations, or build signed APKs without explicit human approval. Preserve a rollback path.
