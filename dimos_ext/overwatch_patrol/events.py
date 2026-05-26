# AUTO-GENERATED — do not hand-edit.
# Source of truth: packages/schemas/src/events.ts
# Regenerate via: pnpm -F @overwatch/schemas codegen
from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Bbox(_Base):
    x: float
    y: float
    w: float
    h: float


class Detection(_Base):
    klass: str = Field(alias="class")
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: Bbox
    track_id: Optional[str] = None


class Pose(_Base):
    x: float
    y: float
    yaw: float


RobotState = Literal["IDLE", "PATROLLING", "INSPECTING", "COOLDOWN", "MANUAL_OVERRIDE", "OFFLINE"]


class FrameDetections(_Base):
    type: Literal["frame.detections"] = "frame.detections"
    ts: str
    detections: list[Detection]


class RobotStateChanged(_Base):
    type: Literal["robot.state_changed"] = "robot.state_changed"
    ts: str
    state: RobotState
    waypoint_id: Optional[str] = None
    pose: Optional[Pose] = None


class IncidentOpened(_Base):
    type: Literal["incident.opened"] = "incident.opened"
    incident_id: str
    waypoint_id: str
    classes: list[str]
    opened_at: str
    track_id: Optional[str] = None
    inspection_pose: Optional[dict] = None  # {x, y}


class IncidentClosed(_Base):
    type: Literal["incident.closed"] = "incident.closed"
    incident_id: str
    closed_at: str
    status: Literal["closed", "suppressed"]
    duration_ms: float


class ClipReady(_Base):
    type: Literal["clip.ready"] = "clip.ready"
    incident_id: str
    clip_path: str
    poster_path: str
    duration_ms: float


class WaypointSync(_Base):
    type: Literal["waypoint.sync"] = "waypoint.sync"
    waypoint_id: str
    name: str
    pose: Pose
    action: Literal["upsert", "delete"]


OverwatchEvent = Union[
    FrameDetections,
    RobotStateChanged,
    IncidentOpened,
    IncidentClosed,
    ClipReady,
    WaypointSync,
]


LCM_TOPICS = {
    "detections": "/ow/detections",
    "robot_state": "/ow/robot_state",
    "incident_opened": "/ow/incident_opened",
    "incident_closed": "/ow/incident_closed",
    "clip_ready": "/ow/clip_ready",
    "waypoint_sync": "/ow/waypoint_sync",
}
