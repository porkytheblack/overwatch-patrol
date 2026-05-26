"""WaypointPatrolRouter — cycles through enabled waypoints in order.

Sibling of dimos's `coverage / random / frontier` routers. Designed to be a
subclass of `dimos.navigation.patrolling.routers.patrol_router.PatrolRouter`
when dimos is available; for unit tests the pure cycling logic stands on
its own.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Literal, Optional, Sequence

CycleMode = Literal["loop", "pingpong"]


@dataclass
class Pose:
    x: float
    y: float
    yaw: float


@dataclass
class WaypointPatrolRouter:
    waypoints: list[Pose] = field(default_factory=list)
    cycle_mode: CycleMode = "loop"
    clearance_radius_m: float = 0.3
    cursor: int = 0
    _direction: int = 1  # for pingpong

    @classmethod
    def from_iter(cls, poses: Iterable[Pose], cycle_mode: CycleMode = "loop") -> "WaypointPatrolRouter":
        return cls(waypoints=list(poses), cycle_mode=cycle_mode)

    def reset(self) -> None:
        self.cursor = 0
        self._direction = 1

    def reset_to(self, index: int) -> None:
        if not self.waypoints:
            self.cursor = 0
            return
        self.cursor = index % len(self.waypoints)

    def skip(self, n: int = 1) -> None:
        self.reset_to(self.cursor + n)

    def next_goal(self) -> Optional[Pose]:
        if not self.waypoints:
            return None
        goal = self.waypoints[self.cursor]
        if self.cycle_mode == "pingpong":
            nxt = self.cursor + self._direction
            if nxt >= len(self.waypoints) or nxt < 0:
                self._direction *= -1
                nxt = self.cursor + self._direction
            self.cursor = nxt
        else:
            self.cursor = (self.cursor + 1) % len(self.waypoints)
        return goal
