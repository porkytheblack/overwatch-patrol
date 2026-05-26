"""SurveillanceModule — the brain.

Drives the patrol/inspection state machine. Owns the in-memory linger
tracker keyed by (waypoint_id, track_id). Publishes incident lifecycle
events. Exposes `@skill`s via dimos `McpServer`.

This file is structured to import dimos lazily — the package builds and
unit-tests its pure logic (state machine, linger tracker) without dimos
being present. The dimos-coupled paths require `vendor/dimos` to be
available (set up by `make setup`).
"""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

import structlog

from .events import (
    FrameDetections,
    IncidentClosed,
    IncidentOpened,
    RobotStateChanged,
    WaypointSync,
)
from .linger_tracker import LingerTracker
from .state_machine import State, StateContext, may_open_incident

if TYPE_CHECKING:
    # Imported only for typing; the runtime import is deferred so non-robot
    # environments can still import this module for unit tests.
    pass

log = structlog.get_logger()


@dataclass
class SurveillanceModuleConfig:
    detector_period_s: float = 0.2
    patrol_grace_seconds: float = 5.0
    manual_override_idle_seconds: float = 60.0
    inspection_timeout_seconds: float = 30.0
    cooldown_seconds: float = 3.0


@dataclass
class WaypointSpec:
    id: str
    name: str
    pose_x: float
    pose_y: float
    pose_yaw: float
    targets: list[str]
    linger_threshold_seconds: float = 5.0
    inspection_dwell_seconds: float = 4.0
    min_standoff_m: float = 1.5
    enabled: bool = True


@dataclass
class SurveillanceModule:
    """Skeleton implementation. The robot blueprint plugs the dimos-coupled
    methods (`publish_lcm`, `current_pose`, `nav_goto`, …) at runtime.
    """

    config: SurveillanceModuleConfig = field(default_factory=SurveillanceModuleConfig)
    ctx: StateContext = field(default_factory=StateContext)
    tracker: LingerTracker = field(init=False)
    waypoints: list[WaypointSpec] = field(default_factory=list)
    last_manual_command_at: float = 0.0
    last_state_publish_at: float = 0.0

    # Plugged at runtime by the blueprint.
    publish_lcm: callable = lambda _topic, _payload: None  # type: ignore
    current_pose: callable = lambda: (0.0, 0.0, 0.0)  # type: ignore
    nav_goto: callable = lambda _x, _y, _yaw: True  # type: ignore

    def __post_init__(self) -> None:
        self.tracker = LingerTracker(self.config.patrol_grace_seconds)

    # ---- LCM event helpers ------------------------------------------------

    def _publish_state(self, waypoint_id: Optional[str] = None) -> None:
        pose = self.current_pose()
        evt = RobotStateChanged(
            ts=_now_iso(),
            state=self.ctx.state.value,  # type: ignore[arg-type]
            waypoint_id=waypoint_id,
            pose={"x": pose[0], "y": pose[1], "yaw": pose[2]},  # type: ignore[arg-type]
        )
        self.publish_lcm("/ow/robot_state", evt.model_dump(by_alias=True))
        self.last_state_publish_at = time.time()

    def _open_incident(self, waypoint: WaypointSpec, classes: list[str], track_id: Optional[str]) -> str:
        incident_id = str(uuid.uuid4())
        evt = IncidentOpened(
            incident_id=incident_id,
            waypoint_id=waypoint.id,
            classes=classes,
            opened_at=_now_iso(),
            track_id=track_id,
        )
        self.publish_lcm("/ow/incident_opened", evt.model_dump(by_alias=True))
        self.ctx.active_incident_id = incident_id
        self.ctx.active_track_id = track_id
        return incident_id

    def _close_incident(self, status: str, duration_ms: float) -> None:
        if not self.ctx.active_incident_id:
            return
        evt = IncidentClosed(
            incident_id=self.ctx.active_incident_id,
            closed_at=_now_iso(),
            status=status,  # type: ignore[arg-type]
            duration_ms=duration_ms,
        )
        self.publish_lcm("/ow/incident_closed", evt.model_dump(by_alias=True))
        self.ctx.active_incident_id = None
        self.ctx.active_track_id = None

    # ---- Detection ingestion ---------------------------------------------

    def on_detections(self, ts: float, waypoint: WaypointSpec, detections: list[dict]) -> None:
        """Pure logic the blueprint feeds detection batches into."""
        # Always emit detections so the bridge can broadcast.
        evt = FrameDetections(
            ts=_iso(ts),
            detections=[{**d} for d in detections],
        )
        self.publish_lcm("/ow/detections", evt.model_dump(by_alias=True))

        if not may_open_incident(self.ctx.state):
            return

        for det in detections:
            klass = det["class"]
            if klass not in waypoint.targets:
                continue
            track_id = det.get("track_id") or det["class"] + ":noid"
            st = self.tracker.observe(waypoint.id, track_id, ts)
            if st.incident_opened:
                continue
            if self.tracker.linger_seconds(waypoint.id, track_id, ts) >= waypoint.linger_threshold_seconds:
                iid = self._open_incident(waypoint, [klass], track_id)
                self.tracker.mark_opened(waypoint.id, track_id, iid)
                self.ctx.transition("target_lingered")
                self._publish_state(waypoint.id)

    # ---- Skills (exposed via dimos `McpServer` in the blueprint) ----------

    def start_surveillance(self) -> str:
        if self.ctx.state != State.IDLE:
            return json.dumps({"ok": False, "reason": f"state is {self.ctx.state.value}"})
        self.ctx.transition("start")
        self._publish_state()
        log.info("surveillance.started")
        return json.dumps({"ok": True})

    def stop_surveillance(self) -> str:
        self.ctx.transition("stop")
        self._publish_state()
        log.info("surveillance.stopped")
        return json.dumps({"ok": True})

    def pause_patrol(self) -> str:
        self.ctx.transition("manual_command")
        self._publish_state()
        return json.dumps({"ok": True})

    def resume_patrol(self) -> str:
        self.ctx.transition("resume_patrol")
        self._publish_state()
        return json.dumps({"ok": True})

    def add_waypoint(self, name: str) -> str:
        x, y, yaw = self.current_pose()
        wp = WaypointSpec(
            id=str(uuid.uuid4()),
            name=name,
            pose_x=x,
            pose_y=y,
            pose_yaw=yaw,
            targets=[],
        )
        self.waypoints.append(wp)
        evt = WaypointSync(
            waypoint_id=wp.id,
            name=wp.name,
            pose={"x": x, "y": y, "yaw": yaw},
            action="upsert",
        )
        self.publish_lcm("/ow/waypoint_sync", evt.model_dump(by_alias=True))
        return json.dumps({"ok": True, "waypoint_id": wp.id})

    def delete_waypoint(self, name: str) -> str:
        before = len(self.waypoints)
        self.waypoints = [w for w in self.waypoints if w.name != name]
        if len(self.waypoints) == before:
            return json.dumps({"ok": False, "reason": "not_found"})
        # Find the deleted id from the LCM history isn't necessary here — the
        # bridge upserts by name in the storage layer.
        return json.dumps({"ok": True, "removed": before - len(self.waypoints)})

    def list_waypoints(self) -> str:
        return json.dumps(
            {
                "waypoints": [
                    {
                        "id": w.id,
                        "name": w.name,
                        "pose": {"x": w.pose_x, "y": w.pose_y, "yaw": w.pose_yaw},
                        "targets": w.targets,
                        "enabled": w.enabled,
                    }
                    for w in self.waypoints
                ],
            }
        )

    def go_to_waypoint(self, name: str) -> str:
        wp = next((w for w in self.waypoints if w.name == name), None)
        if not wp:
            return json.dumps({"ok": False, "reason": "not_found"})
        self.ctx.transition("manual_command")
        self._publish_state(wp.id)
        ok = self.nav_goto(wp.pose_x, wp.pose_y, wp.pose_yaw)
        return json.dumps({"ok": ok, "waypoint": name})

    def set_targets(self, classes: list[str]) -> str:
        for w in self.waypoints:
            w.targets = list(classes)
        return json.dumps({"ok": True, "applied_to": len(self.waypoints)})

    def force_inspect(self, query: str) -> str:
        # Stub: real impl invokes VLM describe at current pose.
        return json.dumps({"ok": True, "query": query, "result": "VLM unavailable in skeleton."})

    def get_robot_state(self) -> str:
        x, y, yaw = self.current_pose()
        return json.dumps(
            {
                "state": self.ctx.state.value,
                "cursor_index": self.ctx.cursor_index,
                "active_incident_id": self.ctx.active_incident_id,
                "pose": {"x": x, "y": y, "yaw": yaw},
            }
        )


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _iso(epoch_s: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(epoch_s, tz=timezone.utc).isoformat()
