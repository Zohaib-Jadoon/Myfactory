# Self-Improving Learning & Reflection Engine (`src/memory.mjs`, `src/improvement.mjs`)

Myfactory improves future planning, routing, UI hierarchy, and deployment choices through evidence-backed memory rather than unverified guesses or uncontrolled code self-edits.

## Learning Pipeline & Safeguards

1. **Capture:** `verify()` automatically records verified task passes (`verified_lesson`) or blocked/failed gate details (`failures` observation). Explicit instructions and repeated corrections enter via `factory learn`.
2. **Failed Tasks Blocked as Success Patterns:** Attempting to record `verified_lesson` for a `failed`/`blocked` task outside `failures` / `mistakes-to-avoid` is rejected with an error.
3. **Unverified Assertion Guard:** `source_type: 'ai_assertion'` or unverified claims are downgraded to `candidate_lesson` (`verification_status: 'candidate'`).
4. **Explicit vs Inferred Separation:** `--explicit` records `source_type: 'explicit_user'`. Inferred feedback always enters as `inferred_preference` (`verification_status: 'candidate'`) and requires `factory memory approve --id <id>` before `retrieveRelevantMemories()` surfaces it globally.
5. **Deduplication & Consolidation:** `memoryFingerprint()` merges repeated identical lessons by incrementing `version` and raising confidence incrementally. `factory memory consolidate` collapses >= 85% token-overlap duplicates in the same scope/category and deprecates stale unverified items (`> 180` days).
6. **Project Overrides & Isolation:** Unapproved project memories stay strictly inside their `project_id`. Project-scoped explicit preferences override conflicting global defaults in the same category without deleting the global record.

## Workflow Effectiveness Reflection (`factory reflect .`)

`analyzeFactoryEffectiveness()` and `proposeImprovements()` inspect real `tasks`, `gate_runs`, `routing_decisions`, and `context_metrics` rows to propose evidence-backed workflow improvements (`improvement_proposals` table, `status: 'proposed'`), never rewriting core factory source automatically.

## CLI Workflow Example (Cross-Project Reuse)

```bash
# Project A: capture UI preference & promote after review
factory learn . --from-feedback --statement "Keep Next.js dashboards uncluttered with mobile breakpoints" --category ui-ux
factory memory review
factory memory approve --id <candidate-id> --by "Owner"

# Project B: initialize new Next.js project and retrieve approved global UI preference automatically
factory init ../next-dashboard --profile auto
```
