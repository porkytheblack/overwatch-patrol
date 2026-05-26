# AUTO-GENERATED — do not hand-edit.
# Source of truth: packages/schemas/src/events.ts
# Regenerate via: pnpm -F @overwatch/schemas codegen
from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


# UUID v7 wire-format: canonical 8-4-4-4-12 string. Validated by length only
# (the producer is dimos / ov-bridge, both of which generate true v7 UUIDs).
UuidStr = Annotated[str, Field(min_length=36, max_length=36)]
# ISO-8601 UTC string (e.g. "2025-01-01T12:34:56.789Z" or "...+00:00").
IsoDatetime = Annotated[str, Field(min_length=20)]


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Bbox(_Base):
    x: float
    y: float
    w: float
    h: float


class Vec2(_Base):
    x: float
    y: float


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
    ts: IsoDatetime
    detections: list[Detection]


class RobotStateChanged(_Base):
    type: Literal["robot.state_changed"] = "robot.state_changed"
    ts: IsoDatetime
    state: RobotState
    waypoint_id: Optional[UuidStr] = None
    pose: Optional[Pose] = None


class IncidentOpened(_Base):
    type: Literal["incident.opened"] = "incident.opened"
    incident_id: UuidStr
    waypoint_id: UuidStr
    classes: list[str]
    opened_at: IsoDatetime
    track_id: Optional[str] = None
    inspection_pose: Optional[Vec2] = None


class IncidentClosed(_Base):
    type: Literal["incident.closed"] = "incident.closed"
    incident_id: UuidStr
    closed_at: IsoDatetime
    status: Literal["closed", "suppressed"]
    duration_ms: float


class ClipReady(_Base):
    type: Literal["clip.ready"] = "clip.ready"
    incident_id: UuidStr
    clip_path: str
    poster_path: str
    duration_ms: float


class WaypointSync(_Base):
    type: Literal["waypoint.sync"] = "waypoint.sync"
    waypoint_id: UuidStr
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
