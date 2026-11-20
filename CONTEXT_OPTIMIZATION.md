# Context & Token Optimization (`src/context-engine.mjs`)

Myfactory bounds prompt assembly using progressive loading rather than injecting all 60 agents, all skills, and all playbooks into every task.

## 10-Step Context Loading Sequence (`buildTaskContext`)

1. Minimal global operating policy digest (~290 bytes).
2. Task request & acceptance target.
3. Cached project profile & stack summary (`.factory/cache/context-cache.json`, keyed by `git HEAD` + `.factory/config.json` SHA-256).
4. Relevant Project Memory (`retrieveRelevantMemories`).
5. Approved profile-compatible Global Memory lessons (never unapproved candidates or unrelated domains).
6. Selected specialist definitions only (`1` in `FAST`, up to `3` in `STANDARD`, up to `5` in `DEEP`/`RELEASE`).
7. Selected `SKILL.md` headers/bodies only.
8. Lazy `references/playbook.md` pointers loaded only in `DEEP`/`RELEASE` or `--load-references` within budget (`FAST`: 8,000 B, `STANDARD`: 20,000 B, `DEEP`: 42,000 B, `RELEASE`: 50,000 B).
9. Execute task.
10. Persist `context_metrics` row (`estimated_context_bytes`, `baseline_context_bytes`, `duration_ms`, `agent_invocations`, and nullable `input_tokens`/`output_tokens`/`cost_usd`).

## Measured Context Benchmark (`node bin/factory.mjs context benchmark .`)

Measured directly against this repository (`baseline_bytes = 154,737` bytes across `101` Markdown/rule/agent/skill files):

| Scenario | Mode | Loaded Agents | Loaded Skills | Loaded Refs | Context Bundle Bytes | Byte Reduction vs Full Load |
|---|---|---|---|---|---|---|
| `FAST typo tweak` | `FAST` | `1` | `1` | `0` | `3,511` | `97.73%` |
| `STANDARD backend bug` | `STANDARD` | `3` | `4` | `0` (`3` deferred) | `10,854` | `92.99%` |
| `DEEP biometric GPS mobile` | `DEEP` | `5` | `6` | `5` | `25,449` | `83.55%` |
| `RELEASE verification` | `RELEASE` | `5` | `7` | `2` | `22,681` | `85.34%` |

**Honest Telemetry Notice:** `input_tokens`, `output_tokens`, and `cost_usd` are reported as `unavailable` when offline without live IDE/provider API response telemetry. Real measured file-byte payload reductions are reported above; LLM token savings are not fabricated.
