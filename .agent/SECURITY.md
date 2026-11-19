# Security & Environment Policy

- Store environment variable **NAMES** only in `.env.example` and `.agent/ENVIRONMENT.md`.
- `human_approval_required: true` and `automatic_deployment: false` are enforced by factory policy.
- Never commit `.env`, private keys, or credentials.
