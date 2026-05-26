"""WaypointPatrolRouter — cycles through enabled waypoints in order.

Sibling of dimos's `coverage / random / frontier` routers. When dimos is
available it subclasses
`dimos.navigation.patrolling.routers.patrol_router.PatrolRouter` so it
plugs into the dimos navigation stack; when it's not (CI / unit tests),
the pure cycling logic stands on its own.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Literal, Optional

try:  # pragma: no cover
    from dimos.navigation.patrolling.routers.patrol_router import (  # type: ignore
        PatrolRouter as _DimosPatrolRouter,
    )
except Exception:  # pragma: no cover
    _DimosPatrolRouter = object  # type: ignore[misc,assignment]


CycleMode = Literal["loop", "pingpong"]


@dataclass
class Pose:
    x: float
    y: float
    yaw: float

    def to_pose_stamped(self) -> Any:  # pragma: no cover - dimos-only path
        """Adapter: returns a `geometry_msgs/PoseStamped`-shaped object when
        the dimos / ROS types are importable. In environments without
        ROS, returns `self` so callers can still introspect.
        """
        try:
            from geometry_msgs.msg import PoseStamped  # type: ignore
            from std_msgs.msg import Header  # type: ignore
            import math

            ps = PoseStamped()
            ps.header = Header()
            ps.pose.position.x = self.x
            ps.pose.position.y = self.y
            # yaw → quaternion (Z-axis rotation)
            half = self.yaw / 2.0
            ps.pose.orientation.z = math.sin(half)
            ps.pose.orientation.w = math.cos(half)
            return ps
        except Exception:
            return self


@dataclass
class WaypointPatrolRouter(_DimosPatrolRouter):  # type: ignore[misc]
    waypoints: list[Pose] = field(default_factory=list)
    cycle_mode: CycleMode = "loop"
    clearance_radius_m: float = 0.3
    cursor: int = 0
    _direction: int = 1  # for pingpong

    @classmethod
    def from_iter(
        cls, poses: Iterable[Pose], cycle_mode: CycleMode = "loop"
    ) -> "WaypointPatrolRouter":
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
        """Return the next waypoint pose, advancing the cursor.

        When subclassed against dimos's `PatrolRouter`, callers can wrap
        the result with `.to_pose_stamped()` to obtain a `PoseStamped`.
        """
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
