"""In-memory linger tracker keyed by (waypoint_id, track_id).

The surveillance module asks `update()` per detection batch with the current
clock; when the elapsed time for a track crosses its waypoint's threshold,
`open_incident()` should be called (the caller handles publishing).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class TrackState:
    waypoint_id: str
    track_id: str
    first_seen: float
    last_seen: float
    incident_opened: bool = False
    incident_id: Optional[str] = None


class LingerTracker:
    def __init__(self, grace_seconds: float = 5.0) -> None:
        self.grace_seconds = grace_seconds
        self._tracks: dict[tuple[str, str], TrackState] = {}

    def observe(self, waypoint_id: str, track_id: str, now: float) -> TrackState:
        key = (waypoint_id, track_id)
        if key not in self._tracks:
            self._tracks[key] = TrackState(waypoint_id, track_id, now, now)
        else:
            self._tracks[key].last_seen = now
        return self._tracks[key]

    def linger_seconds(self, waypoint_id: str, track_id: str, now: float) -> float:
        st = self._tracks.get((waypoint_id, track_id))
        if not st:
            return 0.0
        return now - st.first_seen

    def mark_opened(self, waypoint_id: str, track_id: str, incident_id: str) -> None:
        key = (waypoint_id, track_id)
        if key in self._tracks:
            self._tracks[key].incident_opened = True
            self._tracks[key].incident_id = incident_id

    def expire(self, now: float) -> list[TrackState]:
        """Remove tracks not seen within `grace_seconds`; return removed states."""
        expired = []
        for key, st in list(self._tracks.items()):
            if now - st.last_seen > self.grace_seconds:
                expired.append(st)
                del self._tracks[key]
        return expired

    def get(self, waypoint_id: str, track_id: str) -> Optional[TrackState]:
        return self._tracks.get((waypoint_id, track_id))

    def reset(self) -> None:
        self._tracks.clear()
