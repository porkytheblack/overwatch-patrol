"""Overwatch Patrol — dimos extension package.

Modules:
- `events`            — Pydantic mirrors of the zod schemas (codegen, do not hand-edit).
- `surveillance_module` — the brain: state machine + linger tracker + incident lifecycle.
- `waypoint_patrol_router` — `next_goal()` cycler over `SpatialMemory` waypoints.
- `clip_recorder`     — ring-buffered MP4 writer with bbox overlays.
- `query_module`      — read-only `@skill`s wrapping SQLite for the agent.
- `blueprints.go2_overwatch` — composes the full robot stack.
"""

__version__ = "0.1.0"
