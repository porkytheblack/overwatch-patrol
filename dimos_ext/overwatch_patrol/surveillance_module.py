"""SurveillanceModule — the brain.

Drives the patrol/inspection state machine. Owns the in-memory linger
tracker keyed by (waypoint_id, track_id). Publishes incident lifecycle
events. Exposes `@skill`s via dimos `McpServer`.

This file imports dimos lazily — pure logic (state machine, linger
tracker) can be unit-tested without dimos installed. The dimos-coupled
paths (`@skill`, `CameraInfo`, `.blueprint()`) resolve once
`dimos[base,unitree]` is installed (see `make setup`).
"""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Optional

import structlog

from .events import (
    FrameDetections,
    IncidentClosed,
    IncidentOpened,
    RobotStateChanged,
    WaypointSync,
)
from .linger_tracker import LingerTracker
from .state_machine import State, StateContext

# ---------------------------------------------------------------------------
# dimos coupling (lazy)
#
# `@skill` is a dimos decorator that registers a method on the MCP server.
# `CameraInfo` is a dimos type. When `dimos` isn't installed
# (CI / unit tests), we fall back to a transparent identity decorator
# and a stub type so this module still imports cleanly.
# ---------------------------------------------------------------------------

try:  # pragma: no cover - exercised on the robot host
    from dimos.agents.skills.skill_decorator import skill  # type: ignore
except Exception:  # pragma: no cover - exercised in CI
    def skill(fn=None, **_kwargs):  # type: ignore[no-redef]
        """No-op fallback when dimos isn't importable."""
        if fn is None:
            return lambda f: f
        return fn


if TYPE_CHECKING:  # pragma: no cover
    from dimos.perception.camera_info import CameraInfo  # type: ignore
else:
    CameraInfo = Any  # type: ignore[assignment,misc]


log = structlog.get_logger()


@dataclass
class SurveillanceModuleConfig:
    """Configuration mirrors spec.md §7.1."""

    camera_info: Optional[CameraInfo] = None
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
    """The runtime brain.

    The blueprint plugs runtime hooks (`publish_lcm`, `current_pose`,
    `nav_goto`, `cancel_goal`, `vlm_describe`, `spatial_memory_upsert`)
    after construction.
    """

    config: SurveillanceModuleConfig = field(default_factory=SurveillanceModuleConfig)
    ctx: StateContext = field(default_factory=StateContext)
    tracker: LingerTracker = field(init=False)
    waypoints: list[WaypointSpec] = field(default_factory=list)
    global_targets: Optional[list[str]] = None

    last_manual_command_at: float = 0.0
    last_state_publish_at: float = 0.0
    inspection_started_at: float = 0.0
    cooldown_started_at: float = 0.0

    # Runtime hooks — plugged by the blueprint. Defaults make this module
    # importable + unit-testable without dimos.
    publish_lcm: Callable[[str, dict], None] = field(
        default=lambda _topic, _payload: None,
    )
    current_pose: Callable[[], tuple[float, float, float]] = field(
        default=lambda: (0.0, 0.0, 0.0),
    )
    nav_goto: Callable[[float, float, float], bool] = field(
        default=lambda _x, _y, _yaw: True,
    )
    cancel_goal: Callable[[], None] = field(default=lambda: None)
    vlm_describe: Callable[[str], str] = field(
        default=lambda _query: "VLM not configured",
    )
    spatial_memory_upsert: Callable[[WaypointSpec], None] = field(
        default=lambda _wp: None,
    )
    spatial_memory_delete: Callable[[str], None] = field(
        default=lambda _wp_id: None,
    )
    clock: Callable[[], float] = field(default=time.time)

    def __post_init__(self) -> None:
        self.tracker = LingerTracker(self.config.patrol_grace_seconds)

    # ------------------------------------------------------------------
    # dimos blueprint integration
    # ------------------------------------------------------------------

    @classmethod
    def blueprint(cls, **kwargs: Any) -> Any:
        """Return the dimos blueprint adapter for this module.

        Defers to dimos's blueprint factory when available; falls back to
        a thin wrapper that just constructs an instance, so non-robot
        environments can import this without failing.
        """
        try:  # pragma: no cover
            from dimos.core.coordination.blueprints import module_blueprint  # type: ignore

            return module_blueprint(cls, **kwargs)
        except Exception:
            config = SurveillanceModuleConfig(**kwargs) if kwargs else SurveillanceModuleConfig()
            return cls(config=config)

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
        self.publish_lcm("/ow/robot_state", evt.model_dump(by_alias=True))
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
        self.publish_lcm("/ow/incident_opened", evt.model_dump(by_alias=True))
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
        self.publish_lcm("/ow/incident_closed", evt.model_dump(by_alias=True))
        self.ctx.active_incident_id = None
        self.ctx.active_track_id = None

    def _resolve_targets(self, waypoint: WaypointSpec) -> list[str]:
        """Global override (set_targets) wins over per-waypoint targets."""
        if self.global_targets is not None:
            return self.global_targets
        return waypoint.targets

    def _gate_open_incident(self, track_id: str) -> bool:
        """§8 invariant: PATROLLING + INSPECTING may open incidents, but
        INSPECTING blocks *other* tracks until it returns.
        """
        st = self.ctx.state
        if st == State.PATROLLING:
            return True
        if st == State.INSPECTING:
            # Same track? already opened. Other track? block.
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
        """The blueprint feeds detection batches here.

        Always publishes `/ow/detections`. Opens incidents only when the
        state machine allows (see `_gate_open_incident`). Manual override
        still publishes detections but never opens incidents.
        """
        evt = FrameDetections(
            ts=_iso(ts),
            detections=[{**d} for d in detections],
        )
        self.publish_lcm("/ow/detections", evt.model_dump(by_alias=True))

        targets = self._resolve_targets(waypoint)

        # Phase 1: refresh `last_seen` for every track present in this frame
        # and potentially open new incidents.
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

        # Phase 2: expire stale tracks. Tracks present in this frame had
        # their `last_seen` refreshed in Phase 1, so only genuinely-lost
        # tracks will expire here — driving the "suppressed" path.
        for expired in self.tracker.expire(ts):
            if expired.incident_opened and expired.incident_id == self.ctx.active_incident_id:
                duration_ms = (ts - expired.first_seen) * 1000.0
                self._close_incident("suppressed", duration_ms)
                self.ctx.transition("target_lost")
                self.cooldown_started_at = self.clock()
                self._publish_state(waypoint.id)

    # ------------------------------------------------------------------
    # Periodic tick — drives timeouts the spec calls out:
    #   §8: MANUAL_OVERRIDE → PATROLLING after 60s idle
    #   §7.1: inspection_timeout, cooldown_seconds
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
    # Skills — exposed via dimos `McpServer` in the blueprint.
    # ------------------------------------------------------------------

    @skill
    def start_surveillance(self) -> str:
        if self.ctx.state != State.IDLE:
            return json.dumps({"ok": False, "reason": f"state is {self.ctx.state.value}"})
        self.ctx.transition("start")
        self._publish_state()
        log.info("surveillance.started")
        return json.dumps({"ok": True})

    @skill
    def stop_surveillance(self) -> str:
        self.ctx.transition("stop")
        self.tracker.reset()
        self.global_targets = None
        self._publish_state()
        log.info("surveillance.stopped")
        return json.dumps({"ok": True})

    @skill
    def pause_patrol(self) -> str:
        self.last_manual_command_at = self.clock()
        self.cancel_goal()
        self.ctx.transition("manual_command")
        self._publish_state()
        return json.dumps({"ok": True})

    @skill
    def resume_patrol(self) -> str:
        self.ctx.transition("resume_patrol")
        self._publish_state()
        return json.dumps({"ok": True})

    @skill
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
        self.publish_lcm("/ow/waypoint_sync", evt.model_dump(by_alias=True))
        return json.dumps({"ok": True, "waypoint_id": wp.id})

    @skill
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
        self.publish_lcm("/ow/waypoint_sync", evt.model_dump(by_alias=True))
        return json.dumps({"ok": True, "waypoint_id": removed.id})

    @skill
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

    @skill
    def go_to_waypoint(self, name: str) -> str:
        wp = next((w for w in self.waypoints if w.name == name), None)
        if not wp:
            return json.dumps({"ok": False, "reason": "not_found"})
        # §9.2: cancel any pending patrol goal before issuing the manual one.
        if self.ctx.state in (State.PATROLLING, State.INSPECTING):
            self.cancel_goal()
        self.last_manual_command_at = self.clock()
        self.ctx.transition("manual_command")
        self._publish_state(wp.id)
        ok = self.nav_goto(wp.pose_x, wp.pose_y, wp.pose_yaw)
        return json.dumps({"ok": ok, "waypoint": name})

    @skill
    def set_targets(self, classes: list[str]) -> str:
        """Global override — applies to all waypoints, including future ones."""
        self.global_targets = list(classes)
        return json.dumps({"ok": True, "applied_to_all": True})

    @skill
    def force_inspect(self, query: str) -> str:
        result = self.vlm_describe(query)
        return json.dumps({"ok": True, "query": query, "result": result})

    @skill
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
