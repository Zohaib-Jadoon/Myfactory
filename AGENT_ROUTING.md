# Smart Agent Routing (`src/router.mjs`)

Myfactory selects the minimum specialist set suited to the task rather than loading or running all 60 agents.

## Complexity Modes (`classifyComplexity`)

| Mode | Max Agents | Max Skills | Reference Loading | pstack / Ponytail Intensity |
|---|---|---|---|---|
| `FAST` | `1` (primary only) | `2` | Deferred | `lite` / `lite` |
| `STANDARD` | `3` (1 primary + 2 supporting) | `4` | Deferred | `standard` / `full` |
| `DEEP` | `5` (1 primary + 4 supporting) | `6` | Loaded within budget | `full` / `full` |
| `RELEASE` | `5` (`release-verifier` + release gates) | `6` | Loaded within budget | `full` / `full` |

## Selection & Domain Boundaries (`selectSpecialists`)

1. **Hard Domain Exclusion (`isSpecialistAllowed`):** Prevents cross-domain leakage. Game specialists activate only for `game` profiles or game engine cues (`unity`, `unreal`, `godot`, `shader`, `netcode`). IIS / Classic ASP / MSSQL specialists activate only for Windows/IIS/SQL Server cues. Mobile, Desktop, Biometric, and IoT specialists follow matching profile/stack/file signals.
2. **Weighted Scoring:** Ranks allowed specialists using keyword matches, stack adapters, project profile affinity, file patterns, and relevant memory categories.
3. **Isolated Parallelism:** `parallelizable_groups` marks concurrent engineering specialists only when tasks own disjoint paths inside isolated Git worktrees (`factory/<task-id>`).

```bash
factory agents select . --request "Fix NestJS authentication guard bug"
# -> primary_agent: backend-architect, supporting_agents: ["regression-debugger"]

factory agents explain . --request "Fix typo in button label"
# -> complexity: FAST, supporting_agents: [], pstack=lite, ponytail=lite
```
