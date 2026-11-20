---
name: eng-ai-biometrics
description: AI and biometric standards for face verification, liveness/anti-spoofing evals, FAR/FRR metrics, service boundaries, privacy, and OS vs external hardware separation.
---
# Engineering Standards — AI & Biometrics

Load `references/playbook.md` for face/fingerprint verification, liveness anti-spoofing, evaluation harnesses, or AI service design.

## Core Checklist
1. Separate OS device unlock (`BiometricPrompt`/`FaceID`) from external fingerprint readers or server-side biometric identification.
2. Measure model behavior reproducibly (dataset versioning, FAR, FRR, liveness spoof rejection rate, latency, fallback paths).
3. Enforce strict confidence thresholds, explicit user consent, and audit logs without leaking raw templates/images into shared memory.
4. Keep model inference isolated behind typed service boundaries with deterministic timeout & fallback handling.
