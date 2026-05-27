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

from typing import Any

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
        self.core = SurveillanceCore(
            config=SurveillanceCoreConfig(
                detector_period_s=self.config.detector_period_s,
                patrol_grace_seconds=self.config.patrol_grace_seconds,
                manual_override_idle_seconds=self.config.manual_override_idle_seconds,
                inspection_timeout_seconds=self.config.inspection_timeout_seconds,
                cooldown_seconds=self.config.cooldown_seconds,
            ),
            publish=self._publish_event,
        )

    # ------------------------------------------------------------------
    # Event publishing — currently routes to the structured logger and
    # any subscribers that monkey-patch `_publish_event`. The blueprint
    # will wire LCM transports onto these via dimos's `.transports({...})`
    # convention in a follow-up.
    # ------------------------------------------------------------------

    def _publish_event(self, topic: str, payload: dict) -> None:
        log.debug("surveillance.event", topic=topic, type=payload.get("type"))

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
