"""Pure state-machine logic — extracted so it's unit-testable without LCM / hardware.

States: IDLE, PATROLLING, INSPECTING, COOLDOWN, MANUAL_OVERRIDE.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Literal, Optional


class State(str, Enum):
    IDLE = "IDLE"
    PATROLLING = "PATROLLING"
    INSPECTING = "INSPECTING"
    COOLDOWN = "COOLDOWN"
    MANUAL_OVERRIDE = "MANUAL_OVERRIDE"
    OFFLINE = "OFFLINE"


Event = Literal[
    "start",
    "stop",
    "target_lingered",
    "dwell_complete",
    "target_lost",
    "inspection_timeout",
    "cooldown_complete",
    "manual_command",
    "resume_patrol",
    "manual_idle_timeout",
]


@dataclass
class StateContext:
    state: State = State.IDLE
    cursor_index: int = 0
    saved_cursor: Optional[int] = None
    active_incident_id: Optional[str] = None
    active_track_id: Optional[str] = None
    history: list[tuple[State, Event]] = field(default_factory=list)

    def transition(self, evt: Event) -> tuple[State, State]:
        """Apply an event, return (prev, next). Raises on invalid transitions."""
        prev = self.state
        nxt = _transition(prev, evt, self)
        self.history.append((prev, evt))
        self.state = nxt
        return prev, nxt


# Transition table — mirrors §8 of the spec.
def _transition(state: State, evt: Event, ctx: StateContext) -> State:
    if evt == "stop":
        ctx.cursor_index = 0
        ctx.saved_cursor = None
        ctx.active_incident_id = None
        ctx.active_track_id = None
        return State.IDLE

    if state == State.IDLE:
        if evt == "start":
            return State.PATROLLING
        if evt == "manual_command":
            return State.MANUAL_OVERRIDE

    if state == State.PATROLLING:
        if evt == "target_lingered":
            return State.INSPECTING
        if evt == "manual_command":
            ctx.saved_cursor = ctx.cursor_index
            return State.MANUAL_OVERRIDE

    if state == State.INSPECTING:
        if evt in ("dwell_complete", "target_lost", "inspection_timeout"):
            return State.COOLDOWN
        if evt == "manual_command":
            ctx.saved_cursor = ctx.cursor_index
            return State.MANUAL_OVERRIDE

    if state == State.COOLDOWN:
        if evt == "cooldown_complete":
            return State.PATROLLING
        if evt == "manual_command":
            ctx.saved_cursor = ctx.cursor_index
            return State.MANUAL_OVERRIDE

    if state == State.MANUAL_OVERRIDE:
        if evt in ("resume_patrol", "manual_idle_timeout"):
            if ctx.saved_cursor is not None:
                ctx.cursor_index = ctx.saved_cursor
                ctx.saved_cursor = None
            return State.PATROLLING

    # Default: stay in place. (Useful so noise doesn't crash.)
    return state


def may_open_incident(state: State) -> bool:
    return state in (State.PATROLLING, State.INSPECTING)
