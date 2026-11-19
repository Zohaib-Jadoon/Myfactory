# Workspace .agent Factory Guide

This project uses the Universal AI Software Factory for Google Antigravity IDE (`pstack` + `Ponytail` + gated release pipeline).

- Use `/factory-init`, `/factory-plan`, `/factory-build`, `/factory-status`, `/factory-test`, `/factory-review`, `/factory-fix`, `/factory-release`, and `/factory-resume`.
- CLI commands: `factory init .`, `factory plan . --goal "..."`, `factory run .`, `factory verify .`, `factory review .`, `factory release . --version "0.1.0-rc.1"`, `factory serve .`.
- Never close/restart Antigravity IDE, never auto-deploy/push without explicit approval, and never mark unrun checks as `PASS`.
