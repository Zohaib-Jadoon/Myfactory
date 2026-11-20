# Game Development Playbook

## 1. Engine Architecture & Deterministic Loops
- **Unity:** Cache component references in `Awake`/`Start`, avoid heap allocations/`LINQ`/string concatenation in `Update`/`FixedUpdate`, use `ScriptableObject` configs carefully without mutable shared runtime state leaks. Docs: https://docs.unity3d.com/Manual/
- **Unreal Engine:** Respect `UObject` GC lifetimes (`UPROPERTY()`), replicate state safely on authority (`HasAuthority()`), leverage Enhanced Input and DataAssets. Docs: https://dev.epicgames.com/documentation/
- **Godot 4:** Connect signals cleanly, separate frame interpolation (`_process`) from physics (`_physics_process`), preload scenes/resources intentionally. Docs: https://docs.godotengine.org/

## 2. Multiplayer, Save Systems & Asset Pipelines
- Validate player movement/cooldowns/inventory mutations on the server/host; treat client inputs as unverified requests.
- Version save files with schema magic numbers, checksums, and atomic temp-file writes to prevent save corruption on crash.
- Audit texture compression formats, mesh LODs, audio streaming vs memory decode, and Git LFS tracking for binary assets.

## 3. Frame Budgets & Testing
- Verify core simulation invariants via Unity Test Framework, Godot GUT/GdUnit4, or C++ Automation tests, plus clean exported build startup smoke tests.
