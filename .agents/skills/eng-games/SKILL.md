---
name: eng-games
description: Game engineering standards for Unity C#, Unreal C++, Godot GDScript deterministic loops, scene/asset pipelines, multiplayer netcode, frame/memory budgets, and export QA.
---
# Engineering Standards — Game Development

Load `references/playbook.md` when architecting real-time loops, physics/input systems, multiplayer replication, asset pipelines, or engine exports.

## Core Checklist
1. Keep physics and gameplay simulation deterministic on fixed timesteps (`FixedUpdate` / `_physics_process`), decoupled from frame-render FPS.
2. Enforce explicit frame-time (`16.6ms` for 60 FPS, `8.3ms` for 120 FPS), draw-call, and zero-GC-allocation hot-path budgets.
3. Keep scene hierarchies, prefabs/scenes, input buffering, and save serialization modular without forcing web MVC/CRUD layers.
4. Keep multiplayer state server-authoritative and verify platform export builds alongside automated playmode/unit tests.
