"""SurveillanceModule — dimos `Module` wrapper around `SurveillanceCore`.

The pure logic lives in `surveillance_core.SurveillanceCore` so it can be
unit-tested without dimos. This file is the dimos-coupled adapter: it
inherits from `dimos.core.module.Module`, declares typed In/Out streams,
exposes @rpc + @skill methods, and is composable via `Module.blueprint()`
+ `autoconnect()`.

Skills exposed (spec §7.1):
  start_surveillance, stop_surveillance, pause_patrol, resume_patrol,
  add_waypoint, delete_waypoint, list_waypoints, go_to_waypoint,
  set_targets, force_inspect, get_robot_state.
"""
from __future__ import annotations

import json
import os
from typing import Any, Optional

import structlog

from dimos.agents.annotation import skill
from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig

from .surveillance_core import (
    SurveillanceCore,
    SurveillanceCoreConfig,
    WaypointSpec,
)

log = structlog.get_logger()


class SurveillanceModuleConfig(ModuleConfig):
    """Dimos-compatible config (spec §7.1).

    `camera_info` is intentionally typed `Any` — the dimos `CameraInfo`
    is supplied by the blueprint at compose time.
    """

    camera_info: Any = None
    detector_period_s: float = 0.2
    patrol_grace_seconds: float = 5.0
    manual_override_idle_seconds: float = 60.0
    inspection_timeout_seconds: float = 30.0
    cooldown_seconds: float = 3.0


class SurveillanceModule(Module):
    """dimos Module: the brain."""

    config: SurveillanceModuleConfig

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        # Latest (x, y, yaw) sampled from /odom; `current_pose` reads
        # this so `add_waypoint` captures a real robot location rather
        # than the (0, 0, 0) default.
        self._pose: tuple[float, float, float] = (0.0, 0.0, 0.0)
        self._odom_thread: Optional[Any] = None
        self.core = SurveillanceCore(
            config=SurveillanceCoreConfig(
                detector_period_s=self.config.detector_period_s,
                patrol_grace_seconds=self.config.patrol_grace_seconds,
                manual_override_idle_seconds=self.config.manual_override_idle_seconds,
                inspection_timeout_seconds=self.config.inspection_timeout_seconds,
                cooldown_seconds=self.config.cooldown_seconds,
            ),
            publish=self._publish_event,
            current_pose=lambda: self._pose,
        )
        self._start_odom_listener()

    # ------------------------------------------------------------------
    # Event publishing.
    #
    # SurveillanceCore emits `/ow/*` events (waypoint_sync, robot_state,
    # incident_opened/closed, detections). The bridge subscribes to those
    # raw LCM channels (services/ov-bridge/bridge/lcm_listener.py) and
    # writes to SQLite. We serialise payloads as JSON-encoded
    # `dimos_lcm.std_msgs.String` messages so the bridge can decode
    # without any schema coupling.
    #
    # We use a raw `lcm.LCM(...)` handle rather than dimos's typed
    # transport because the bridge isn't a dimos module — keeping the
    # wire format wire-simple decouples the planes.
    # ------------------------------------------------------------------

    _lc: Optional[Any] = None

    def _start_odom_listener(self) -> None:
        """Subscribe to `/odom#geometry_msgs.PoseStamped` in a daemon
        thread so `add_waypoint` captures the live pose.

        We use raw LCM here for the same reason as the publish path —
        keeping this module decoupled from dimos's typed transport
        bookkeeping. The pose message carries quaternion orientation; we
        convert the yaw component on the fly.
        """
        import threading

        def _run() -> None:
            try:
                import lcm  # type: ignore
                from dimos_lcm.geometry_msgs.PoseStamped import (  # type: ignore
                    PoseStamped,
                )
            except Exception as e:  # noqa: BLE001
                log.warning("surveillance.odom_unavailable", error=str(e))
                return

            lc = lcm.LCM(
                os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
            )

            samples = {"n": 0}

            def _handler(_channel: str, data: bytes) -> None:
                try:
                    msg = PoseStamped.lcm_decode(data)
                    p = msg.pose.position
                    q = msg.pose.orientation
                    # yaw from quaternion (Z-up). Matches the ROS REP-103
                    # convention used elsewhere in dimos.
                    import math

                    siny_cosp = 2.0 * (q.w * q.z + q.x * q.y)
                    cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
                    yaw = math.atan2(siny_cosp, cosy_cosp)
                    self._pose = (float(p.x), float(p.y), float(yaw))
                    samples["n"] += 1
                    if samples["n"] in (1, 10, 100):
                        log.info(
                            "surveillance.odom_sample",
                            count=samples["n"],
                            x=round(self._pose[0], 3),
                            y=round(self._pose[1], 3),
                            yaw=round(self._pose[2], 3),
                        )
                except Exception as e:  # noqa: BLE001
                    log.warning("surveillance.odom_decode_fail", error=str(e))

            # Match both `/odom` and `/odom#geometry_msgs.PoseStamped`
            # — dimos's LCMPubSubBase appends the type suffix when
            # publishing, but other tools use bare channel names.
            lc.subscribe(r"^/odom(#.*)?$", _handler)
            log.info("surveillance.odom_subscribed")
            while True:
                try:
                    lc.handle_timeout(200)
                except Exception:  # noqa: BLE001
                    return

        self._odom_thread = threading.Thread(
            target=_run, daemon=True, name="surveillance-odom",
        )
        self._odom_thread.start()

    def _publish_event(self, topic: str, payload: dict) -> None:
        log.debug("surveillance.event", topic=topic, type=payload.get("type"))
        try:
            if self._lc is None:
                import lcm  # type: ignore

                self._lc = lcm.LCM(
                    os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
                )
            from dimos_lcm.std_msgs.String import String  # type: ignore

            msg = String(data=json.dumps(payload, separators=(",", ":")))
            self._lc.publish(topic, msg.lcm_encode())
        except Exception as e:  # noqa: BLE001
            log.warning(
                "surveillance.publish_fail",
                topic=topic,
                error=str(e),
            )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @rpc
    def start(self) -> None:
        super().start()
        log.info("surveillance.module.started")

    @rpc
    def stop(self) -> None:
        log.info("surveillance.module.stopped")
        super().stop()

    # ------------------------------------------------------------------
    # Skills — exposed via dimos MCP server.
    # ------------------------------------------------------------------

    @rpc
    @skill
    def start_surveillance(self) -> str:
        """Start the patrol loop. State IDLE → PATROLLING."""
        return self.core.start_surveillance()

    @rpc
    @skill
    def stop_surveillance(self) -> str:
        """Stop surveillance entirely. Resets cursor and any active incident."""
        return self.core.stop_surveillance()

    @rpc
    @skill
    def pause_patrol(self) -> str:
        """Hold position. Patrol cursor saved; resume_patrol resumes."""
        return self.core.pause_patrol()

    @rpc
    @skill
    def resume_patrol(self) -> str:
        """Resume patrol from the saved cursor."""
        return self.core.resume_patrol()

    @rpc
    @skill
    def add_waypoint(self, name: str) -> str:
        """Capture the robot's current pose as a named waypoint."""
        return self.core.add_waypoint(name)

    @rpc
    @skill
    def delete_waypoint(self, name: str) -> str:
        """Remove a waypoint by name."""
        return self.core.delete_waypoint(name)

    @rpc
    @skill
    def list_waypoints(self) -> str:
        """Return all known waypoints with poses and targets, as JSON."""
        return self.core.list_waypoints()

    @rpc
    @skill
    def go_to_waypoint(self, name: str) -> str:
        """Navigate to a named waypoint. Patrol pauses, MANUAL_OVERRIDE."""
        return self.core.go_to_waypoint(name)

    @rpc
    @skill
    def set_targets(self, classes: list[str]) -> str:
        """Globally override the detection class list for every waypoint."""
        return self.core.set_targets(classes)

    @rpc
    @skill
    def force_inspect(self, query: str) -> str:
        """Run a VLM describe at the current pose for the given query."""
        return self.core.force_inspect(query)

    @rpc
    @skill
    def get_robot_state(self) -> str:
        """Return current state, cursor, active incident, and pose, as JSON."""
        return self.core.get_robot_state()
