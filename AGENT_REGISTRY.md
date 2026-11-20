# Specialist Agent Registry (`v1.0.0`)

Myfactory defines **60 specialist agents across 9 categories** in [`src/agent-registry.mjs`](src/agent-registry.mjs), mapped cleanly to IDE-discoverable adapters while preserving all **14 core orchestration roles** in [`src/agents.mjs`](src/agents.mjs).

## Generated File Locations

| Layer | Path Pattern | Purpose |
|---|---|---|
| Canonical Master Library | `.agent/agents/<category>/<id>.md` | Categorized master docs + `.agent/agents/manifest.json` |
| Google Antigravity Native | `.agents/agents/<id>/agent.md` | YAML frontmatter (`name`, `description`, `category`, `legacy_role`, `readonly`, `stacks`, `skills`) |
| Cursor IDE Subagents | `.cursor/agents/<id>.md` | Cursor frontmatter (`name`, `description`, `model: inherit`, `readonly`) |

Every specialist defines: `id`, `name`, `responsibility`, `activationConditions`, `supportedStacks`, `requiredInputs`, `toolsAndSkills`, `operatingProcedure`, `qualityRequirements`, `securityBoundaries`, `handoffFormat`, `expectedArtifacts`, `verificationCriteria`, and `humanApprovalConditions`.

## Categories & Agent Inventory (60 Specialists)

1. **`engineering` (22):** `frontend-developer`, `backend-architect`, `fullstack-engineer`, `database-engineer`, `postgres-neon-specialist`, `prisma-specialist`, `sql-server-specialist`, `mobile-app-builder`, `flutter-engineer`, `react-native-engineer`, `ai-ml-engineer`, `biometric-ai-engineer`, `geospatial-engineer`, `iot-telematics-engineer`, `desktop-app-builder`, `electron-engineer`, `windows-iis-engineer`, `legacy-asp-modernizer`, `api-integration-engineer`, `devops-automator`, `rapid-prototyper`, `performance-engineer`
2. **`product` (6):** `requirements-analyst`, `product-manager`, `workflow-designer`, `domain-modeler`, `sprint-prioritizer`, `feedback-synthesizer`
3. **`design` (5):** `ui-designer`, `ux-researcher`, `design-system-engineer`, `brand-guardian`, `accessibility-reviewer`
4. **`project-management` (5):** `factory-director`, `solution-architect`, `integration-coordinator`, `project-shipper`, `release-manager`
5. **`studio-operations` (4):** `infrastructure-maintainer`, `technical-documentarian`, `incident-responder`, `observability-engineer`
6. **`deployment` (1):** `deployment-advisor`
7. **`testing` (7):** `api-tester`, `e2e-tester`, `regression-debugger`, `performance-benchmarker`, `mobile-device-tester`, `database-integrity-tester`, `release-verifier`
8. **`security` (1):** `security-reviewer`
9. **`game-development` (9):** `game-architect`, `gameplay-programmer`, `unity-developer`, `unreal-engine-developer`, `godot-developer`, `multiplayer-network-engineer`, `game-performance-engineer`, `game-qa-tester`, `asset-pipeline-engineer`

## Legacy 14-Role Compatibility Mapping

`resolveSpecialist()` resolves both V1.0 specialist IDs and legacy role IDs (`director -> factory-director`, `product_manager -> product-manager`, `architect -> solution-architect`, `ui_ux -> ui-designer`, `frontend -> frontend-developer`, `backend -> backend-architect`, `database -> database-engineer`, `mobile -> mobile-app-builder`, `ai_ml -> ai-ml-engineer`, `security -> security-reviewer`, `qa -> release-verifier`, `code_review -> regression-debugger`, `devops -> devops-automator`, `documentation -> technical-documentarian`).

## CLI Usage

```bash
factory agents list [--category engineering]
factory agents select . --request "Fix NestJS auth token guard bug"
factory agents explain . --request "Build biometric GPS React Native feature"
```
