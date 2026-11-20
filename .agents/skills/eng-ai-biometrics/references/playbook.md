# AI & Biometric Engineering Playbook

## 1. Biometric Architecture & Privacy Boundaries
- **OS Authentication vs External Identification:** OS biometric prompts prove *this phone's unlocked owner authorized an action*; external attendance/access systems verifying *which employee* is present must track hardware reader/face verification identity and cryptographic device registration independently.
- Encrypt biometric templates at rest using hardware/KMS-managed keys stored only in env/secret vaults; NEVER log or persist embeddings, raw facial frames, or personal identifiers into factory memory or Markdown artifacts.

## 2. Reproducible Model Evaluation
- Version evaluation datasets (genuine pairs, impostor pairs, printed/replay/mask spoof samples) separately from training sets.
- Report False Acceptance Rate (FAR), False Rejection Rate (FRR), Attack Presentation Classification Error Rate (APCER), and sample counts (`N`) honestly; never mark untested spoof checks as passed.

## 3. LLM & Inference Service Boundaries
- Wrap model providers behind strict timeouts, schema-validated structured outputs, prompt-injection delimiters, and graceful fallbacks.
- Log token usage/latency only from real provider responses; record `unavailable` when offline or uninstrumented.
