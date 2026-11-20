---
name: eng-quality
description: Software quality standards covering unit, integration, contract, E2E, regression, security, performance benchmark, and release verification gates.
---
# Engineering Standards — Quality & Testing

Load `references/playbook.md` when designing test harnesses, debugging regressions, benchmarking performance, or certifying release candidates.

## Core Checklist
1. Test observable behavior and error paths, not private implementation details or mocked tautologies.
2. Write a failing reproduction test BEFORE applying a bug fix (`pstack` `principle-fix-root-causes`).
3. Measure performance/benchmarks before and after changes on identical inputs; never fabricate numbers.
4. Never skip, weaken, or comment out failing tests; report unexecuted manual/hardware tests as `NOT VERIFIED`.
