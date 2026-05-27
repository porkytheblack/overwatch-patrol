"""Pure logic for the SurveillanceModule — extracted so it's unit-testable
without dimos / LCM / hardware. The dimos-coupled `SurveillanceModule`
in `surveillance_module.py` is a thin wrapper around this.

States: IDLE, PATROLLING, INSPECTING, COOLDOWN, MANUAL_OVERRIDE (see
state_machine.py).

The caller supplies runtime hooks:
- `publish(topic, payload)` — emit an LCM event
- `current_pose()` — current robot pose tuple (x, y, yaw)
- `nav_goto(x, y, yaw)` — request a navigation goal, returns ok bool
- `cancel_goal()` — cancel the current navigation goal
- `vlm_describe(query)` — VLM describe (for force_inspect)
- `spatial_memory_upsert(wp)` / `spatial_memory_delete(id)` — dimos spatial memory
- `clock()` — monotonic clock, defaults to time.time
"""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

from .events import (
    FrameDetections,
    IncidentClosed,
    IncidentOpened,
    RobotStateChanged,
    WaypointSync,
)
from .linger_tracker import LingerTracker
from .state_machine import State, StateContext


@dataclass
class SurveillanceCoreConfig:
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
class SurveillanceCore:
    """The pure brain. No dimos, no LCM, no hardware coupling."""

    config: SurveillanceCoreConfig = field(default_factory=SurveillanceCoreConfig)
    ctx: StateContext = field(default_factory=StateContext)
    tracker: LingerTracker = field(init=False)
    waypoints: list[WaypointSpec] = field(default_factory=list)
    global_targets: Optional[list[str]] = None

    last_manual_command_at: float = 0.0
    last_state_publish_at: float = 0.0
    inspection_started_at: float = 0.0
    cooldown_started_at: float = 0.0

    # Runtime hooks (defaults make this importable + unit-testable).
    publish: Callable[[str, dict], None] = field(default=lambda _t, _p: None)
    current_pose: Callable[[], tuple[float, float, float]] = field(
        default=lambda: (0.0, 0.0, 0.0),
    )
    nav_goto: Callable[[float, float, float], bool] = field(
        default=lambda _x, _y, _yaw: True,
    )
    cancel_goal: Callable[[], None] = field(default=lambda: None)
    vlm_describe: Callable[[str], str] = field(
        default=lambda _q: "VLM not configured",
    )
    spatial_memory_upsert: Callable[[WaypointSpec], None] = field(
        default=lambda _wp: None,
    )
    spatial_memory_delete: Callable[[str], None] = field(default=lambda _wp_id: None)
    clock: Callable[[], float] = field(default=time.time)

    def __post_init__(self) -> None:
        self.tracker = LingerTracker(self.config.patrol_grace_seconds)

    # ------------------------------------------------------------------
    # LCM event helpers
    # ------------------------------------------------------------------

    def _publish_state(self, waypoint_id: Optional[str] = None) -> None:
        pose = self.current_pose()
        evt = RobotStateChanged(
            ts=_now_iso(),
            state=self.ctx.state.value,  # type: ignore[arg-type]
            waypoint_id=waypoint_id,
            pose={"x": pose[0], "y": pose[1], "yaw": pose[2]},  # type: ignore[arg-type]
        )
        self.publish("/ow/robot_state", evt.model_dump(by_alias=True))
        self.last_state_publish_at = self.clock()

    def _open_incident(
        self,
        waypoint: WaypointSpec,
        classes: list[str],
        track_id: Optional[str],
    ) -> str:
        incident_id = str(uuid.uuid4())
        evt = IncidentOpened(
            incident_id=incident_id,
            waypoint_id=waypoint.id,
            classes=classes,
            opened_at=_now_iso(),
            track_id=track_id,
        )
        self.publish("/ow/incident_opened", evt.model_dump(by_alias=True))
        self.ctx.active_incident_id = incident_id
        self.ctx.active_track_id = track_id
        self.inspection_started_at = self.clock()
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
        self.publish("/ow/incident_closed", evt.model_dump(by_alias=True))
        self.ctx.active_incident_id = None
        self.ctx.active_track_id = None

    def _resolve_targets(self, waypoint: WaypointSpec) -> list[str]:
        if self.global_targets is not None:
            return self.global_targets
        return waypoint.targets

    def _gate_open_incident(self, track_id: str) -> bool:
        st = self.ctx.state
        if st == State.PATROLLING:
            return True
        if st == State.INSPECTING:
            return self.ctx.active_track_id == track_id
        return False

    # ------------------------------------------------------------------
    # Detection ingestion
    # ------------------------------------------------------------------

    def on_detections(
        self,
        ts: float,
        waypoint: WaypointSpec,
        detections: list[dict],
    ) -> None:
        evt = FrameDetections(
            ts=_iso(ts),
            detections=[{**d} for d in detections],
        )
        self.publish("/ow/detections", evt.model_dump(by_alias=True))

        targets = self._resolve_targets(waypoint)
        for det in detections:
            klass = det["class"]
            if klass not in targets:
                continue
            track_id = det.get("track_id") or f"{klass}:noid"
            st = self.tracker.observe(waypoint.id, track_id, ts)
            if st.incident_opened:
                continue
            if not self._gate_open_incident(track_id):
                continue
            if (
                self.tracker.linger_seconds(waypoint.id, track_id, ts)
                >= waypoint.linger_threshold_seconds
            ):
                iid = self._open_incident(waypoint, [klass], track_id)
                self.tracker.mark_opened(waypoint.id, track_id, iid)
                self.ctx.transition("target_lingered")
                self._publish_state(waypoint.id)

        for expired in self.tracker.expire(ts):
            if expired.incident_opened and expired.incident_id == self.ctx.active_incident_id:
                duration_ms = (ts - expired.first_seen) * 1000.0
                self._close_incident("suppressed", duration_ms)
                self.ctx.transition("target_lost")
                self.cooldown_started_at = self.clock()
                self._publish_state(waypoint.id)

    # ------------------------------------------------------------------
    # Periodic tick — drives timeouts
    # ------------------------------------------------------------------

    def tick(self, now: Optional[float] = None) -> None:
        t = now if now is not None else self.clock()
        if self.ctx.state == State.MANUAL_OVERRIDE:
            if (
                self.last_manual_command_at
                and t - self.last_manual_command_at > self.config.manual_override_idle_seconds
            ):
                self.ctx.transition("manual_idle_timeout")
                self._publish_state()
        elif self.ctx.state == State.INSPECTING:
            if (
                self.inspection_started_at
                and t - self.inspection_started_at > self.config.inspection_timeout_seconds
            ):
                duration_ms = (t - self.inspection_started_at) * 1000.0
                self._close_incident("closed", duration_ms)
                self.ctx.transition("inspection_timeout")
                self.cooldown_started_at = t
                self._publish_state()
        elif self.ctx.state == State.COOLDOWN:
            if (
                self.cooldown_started_at
                and t - self.cooldown_started_at > self.config.cooldown_seconds
            ):
                self.ctx.transition("cooldown_complete")
                self._publish_state()

    # ------------------------------------------------------------------
    # Skill implementations (pure — no dimos coupling)
    # ------------------------------------------------------------------

    def start_surveillance(self) -> str:
        if self.ctx.state != State.IDLE:
            return json.dumps({"ok": False, "reason": f"state is {self.ctx.state.value}"})
        self.ctx.transition("start")
        self._publish_state()
        return json.dumps({"ok": True})

    def stop_surveillance(self) -> str:
        self.ctx.transition("stop")
        self.tracker.reset()
        self.global_targets = None
        self._publish_state()
        return json.dumps({"ok": True})

    def pause_patrol(self) -> str:
        self.last_manual_command_at = self.clock()
        self.cancel_goal()
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
        self.spatial_memory_upsert(wp)
        evt = WaypointSync(
            waypoint_id=wp.id,
            name=wp.name,
            pose={"x": x, "y": y, "yaw": yaw},
            action="upsert",
        )
        self.publish("/ow/waypoint_sync", evt.model_dump(by_alias=True))
        return json.dumps({"ok": True, "waypoint_id": wp.id})

    def delete_waypoint(self, name: str) -> str:
        removed = next((w for w in self.waypoints if w.name == name), None)
        if not removed:
            return json.dumps({"ok": False, "reason": "not_found"})
        self.waypoints = [w for w in self.waypoints if w.id != removed.id]
        self.spatial_memory_delete(removed.id)
        evt = WaypointSync(
            waypoint_id=removed.id,
            name=removed.name,
            pose={"x": removed.pose_x, "y": removed.pose_y, "yaw": removed.pose_yaw},
            action="delete",
        )
        self.publish("/ow/waypoint_sync", evt.model_dump(by_alias=True))
        return json.dumps({"ok": True, "waypoint_id": removed.id})

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
        if self.ctx.state in (State.PATROLLING, State.INSPECTING):
            self.cancel_goal()
        self.last_manual_command_at = self.clock()
        self.ctx.transition("manual_command")
        self._publish_state(wp.id)
        ok = self.nav_goto(wp.pose_x, wp.pose_y, wp.pose_yaw)
        return json.dumps({"ok": ok, "waypoint": name})

    def set_targets(self, classes: list[str]) -> str:
        self.global_targets = list(classes)
        return json.dumps({"ok": True, "applied_to_all": True})

    def force_inspect(self, query: str) -> str:
        result = self.vlm_describe(query)
        return json.dumps({"ok": True, "query": query, "result": result})

    def get_robot_state(self) -> str:
        x, y, yaw = self.current_pose()
        return json.dumps(
            {
                "state": self.ctx.state.value,
                "cursor_index": self.ctx.cursor_index,
                "active_incident_id": self.ctx.active_incident_id,
                "active_track_id": self.ctx.active_track_id,
                "pose": {"x": x, "y": y, "yaw": yaw},
            }
        )


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _iso(epoch_s: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(epoch_s, tz=timezone.utc).isoformat()
