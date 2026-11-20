# Three-Level Memory Architecture (`src/memory.mjs`)

Myfactory stores durable engineering knowledge in SQLite (`node:sqlite` WAL) and renders human-readable Markdown views without polluting repositories with private cross-project data.

## Memory Levels

| Level | Storage Location | Lifecycle & Contents |
|---|---|---|
| **Level 1 — Task Memory** | `<project>/.factory/tasks/<id>.memory.json` | Current objective, touched files, task decisions, test results, blockers, continuation notes |
| **Level 2 — Project Memory** | `<project>/.factory/factory.db` -> `.factory/memory/*.md` | Project overview, decisions, lessons, progress, and failure root causes (`project-memory.md`, `decisions.md`, `lessons.md`, `progress.md`, `failures.md`) |
| **Level 3 — Global Memory** | `~/.gemini/factory/memory/global-memory.db` -> Markdown views | Reusable preferences & verified cross-project lessons stored **outside** repos (`user-preferences.md`, `engineering-lessons.md`, `ui-ux-preferences.md`, `architecture-patterns.md`, `deployment-lessons.md`, `mistakes-to-avoid.md`) |

*(Set `FACTORY_GLOBAL_HOME` or `FACTORY_GLOBAL_MEMORY_DB` to isolate global storage in tests or CI.)*

## SQLite `memories` Schema (Migration v2)

Fields: `id`, `type` (`observation`, `candidate_lesson`, `verified_lesson`, `explicit_preference`, `inferred_preference`, `deprecated_lesson`), `scope` (`project`|`global`), `project_id`, `category`, `statement`, `evidence_ref`, `source_type` (`explicit_user`, `user_feedback`, `inferred_from_work`, `verified_task`, `gate_failure`, `ai_assertion`), `confidence`, `verification_status`, `tags_json`, `profile_scope`, `version`, `status`, `fingerprint`, `created_at`, `updated_at`, `last_used_at`.

## Security, Privacy & Portable Export/Import

- `detectSensitiveMemoryContent()` rejects credentials, tokens, private keys, DB passwords, emails, SSN-like numbers, payment cards, JWTs, base64 blobs, and biometric embedding arrays (`face_embedding`, `fingerprint_template`, float arrays).
- `factory memory export --file archive.enc.json --passphrase "..."` creates an integrity-checked (SHA-256) JSON or AES-256-GCM encrypted (`scryptSync`) export of verified/approved active memories only (`--include-candidates` optional).
- `factory memory import archive.enc.json --passphrase "..."` re-verifies checksum and sensitive-content rules before inserting.
