---
trigger: glob
globs: "*.cs, *.gd, *.tscn, *.unity, *.uproject, project.godot"
description: "Unity, Unreal Engine, and Godot real-time game loop, determinism, frame budget, and asset pipeline rules"
---
# Game Engineering Rules (Conditional)

- Apply `eng-games` and route to `game-architect` / engine specialist (`unity-developer`, `unreal-engine-developer`, or `godot-developer`).
- Keep simulation deterministic on fixed timesteps (`FixedUpdate` / `_physics_process`) and enforce frame-time and allocation/memory budgets.
- Do NOT force web REST/MVC abstractions onto real-time engine loops or scene graphs.
- Keep server-authoritative validation for multiplayer state and verify platform export builds explicitly.
