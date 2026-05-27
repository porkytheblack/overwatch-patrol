"""Outbound Twist publisher.

Publishes LCM `Twist` messages on the channel that the Go2 connection
subscribes to (`/cmd_vel#geometry_msgs.Twist` — dimos's transport
appends the message type suffix). This is the velocity-control path
for browser-side teleop: the dashboard streams short Twist commands at
~10 Hz while a key is held, and the robot's `cmd_vel_timeout = 0.2s`
auto-halts the moment the dashboard stops publishing.

A direct `relative_move` loop would re-plan a goal on every tick, which
makes the robot snake and swerve. Velocity commands sidestep the
planner entirely.
"""
from __future__ import annotations

import os
from typing import Optional

import structlog

log = structlog.get_logger()

CMD_VEL_TOPIC = "/cmd_vel#geometry_msgs.Twist"


class CmdVelPublisher:
    def __init__(self, lcm_url: Optional[str] = None) -> None:
        self._lcm_url = lcm_url or os.environ.get(
            "LCM_URL", "udpm://239.255.76.67:7667?ttl=1",
        )
        self._lc = None
        self._Twist = None
        self._Vector3 = None

    def _lazy_init(self) -> bool:
        if self._lc is not None and self._Twist is not None:
            return True
        try:
            import lcm  # type: ignore
            from dimos_lcm.geometry_msgs.Twist import Twist  # type: ignore
            from dimos_lcm.geometry_msgs.Vector3 import Vector3  # type: ignore
        except Exception as e:  # noqa: BLE001
            log.warning("cmd_vel.lcm_unavailable", error=str(e))
            return False
        self._lc = lcm.LCM(self._lcm_url)
        self._Twist = Twist
        self._Vector3 = Vector3
        return True

    def publish(
        self, linear_x: float, linear_y: float, angular_z: float,
    ) -> bool:
        if not self._lazy_init():
            return False
        twist = self._Twist()  # type: ignore[misc]
        twist.linear = self._Vector3()  # type: ignore[misc]
        twist.linear.x = float(linear_x)
        twist.linear.y = float(linear_y)
        twist.linear.z = 0.0
        twist.angular = self._Vector3()  # type: ignore[misc]
        twist.angular.x = 0.0
        twist.angular.y = 0.0
        twist.angular.z = float(angular_z)
        self._lc.publish(CMD_VEL_TOPIC, twist.lcm_encode())  # type: ignore[union-attr]
        return True
