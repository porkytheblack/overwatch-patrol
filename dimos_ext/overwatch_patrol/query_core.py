"""Pure query-module logic — extracted so it's unit-testable without dimos.
The dimos `SurveillanceQueryModule` in `query_module.py` is a thin wrapper.

Returns JSON strings so the LLM can parse uniformly.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Iterator, Literal, Optional


@dataclass
class SurveillanceQueryCore:
    sqlite_path: str
    # Detector FPS is reported by the surveillance module; we read the most
    # recent value (the blueprint can push it onto this field via a callback).
    _detector_fps_ema: float = field(default=0.0)
    _detector_last_sample: float = field(default=0.0)

    def record_detector_tick(self, ts: float) -> None:
        """Blueprint calls this on every detector frame to maintain a smoothed
        FPS estimate available to `get_compound_status`.
        """
        if self._detector_last_sample <= 0:
            self._detector_last_sample = ts
            return
        dt = ts - self._detector_last_sample
        self._detector_last_sample = ts
        if dt <= 0:
            return
        inst = 1.0 / dt
        # Exponential moving average, alpha=0.2
        self._detector_fps_ema = (
            inst if self._detector_fps_ema == 0 else 0.2 * inst + 0.8 * self._detector_fps_ema
        )

    @contextmanager
    def _ro(self) -> Iterator[sqlite3.Connection]:
        # Read-only URI avoids locking conflicts with the bridge's writes.
        uri = f"file:{self.sqlite_path}?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    # ---- @skill: search_incidents ----------------------------------------


    def search_incidents(
        self,
        time_range_start: str,
        time_range_end: str,
        classes: Optional[list[str]] = None,
        waypoint_id: Optional[str] = None,
        status: Literal["open", "closed", "suppressed", "acknowledged", "all"] = "all",
        limit: int = 20,
    ) -> str:
        clauses = ["i.opened_at BETWEEN ? AND ?"]
        args: list = [time_range_start, time_range_end]
        if waypoint_id:
            clauses.append("i.waypoint_id = ?")
            args.append(waypoint_id)
        if status != "all":
            clauses.append("i.status = ?")
            args.append(status)
        with self._ro() as conn:
            rows = conn.execute(
                f"""
                SELECT i.*, w.name AS waypoint_name
                FROM incidents i LEFT JOIN waypoints w ON w.id = i.waypoint_id
                WHERE {' AND '.join(clauses)}
                ORDER BY i.opened_at DESC
                LIMIT ?
                """,
                (*args, limit),
            ).fetchall()
        out = []
        for r in rows:
            row = dict(r)
            row["classes"] = json.loads(row["classes"])
            if classes and not (set(row["classes"]) & set(classes)):
                continue
            out.append(row)
        return json.dumps({"incidents": out})

    # ---- @skill: get_incident_details ------------------------------------


    def get_incident_details(self, incident_id: str) -> str:
        with self._ro() as conn:
            row = conn.execute(
                """
                SELECT i.*, w.name AS waypoint_name
                FROM incidents i LEFT JOIN waypoints w ON w.id = i.waypoint_id
                WHERE i.id = ?
                """,
                (incident_id,),
            ).fetchone()
            if not row:
                return json.dumps({"error": "not_found"})
            dets = conn.execute(
                "SELECT * FROM detections WHERE incident_id = ? ORDER BY ts",
                (incident_id,),
            ).fetchall()
        return json.dumps(
            {
                "incident": {**dict(row), "classes": json.loads(row["classes"])},
                "detections": [{**dict(d), "bbox": json.loads(d["bbox"])} for d in dets],
            }
        )

    # ---- @skill: get_compound_status -------------------------------------


    def get_compound_status(self) -> str:
        with self._ro() as conn:
            robot = conn.execute(
                """
                SELECT r.*, w.name AS current_waypoint_name
                FROM robot_status r
                LEFT JOIN waypoints w ON w.id = r.current_waypoint_id
                WHERE r.id = 1
                """
            ).fetchone()
            open_count = conn.execute(
                "SELECT COUNT(*) AS n FROM incidents WHERE status = 'open'"
            ).fetchone()
            recent = conn.execute(
                """
                SELECT strftime('%Y-%m-%dT%H:00:00Z', opened_at) AS hour, COUNT(*) AS n
                  FROM incidents
                 WHERE opened_at > datetime('now', '-24 hours')
              GROUP BY hour ORDER BY hour
                """
            ).fetchall()
        robot_dict = dict(robot) if robot else None
        return json.dumps(
            {
                "robot_state": robot_dict["state"] if robot_dict else "OFFLINE",
                "current_waypoint": robot_dict["current_waypoint_name"] if robot_dict else None,
                "current_waypoint_id": robot_dict["current_waypoint_id"] if robot_dict else None,
                "last_seen_at": robot_dict["last_seen_at"] if robot_dict else None,
                "pose": (
                    {
                        "x": robot_dict["pose_x"],
                        "y": robot_dict["pose_y"],
                        "yaw": robot_dict["pose_yaw"],
                    }
                    if robot_dict
                    else None
                ),
                "open_incident_count": open_count["n"],
                "detector_fps": round(self._detector_fps_ema, 2),
                "recent_activity": [dict(r) for r in recent],
            }
        )

    # ---- @skill: get_waypoint_context ------------------------------------


    def get_waypoint_context(self, waypoint_id: str) -> str:
        with self._ro() as conn:
            wp = conn.execute(
                "SELECT * FROM waypoints WHERE id = ?", (waypoint_id,)
            ).fetchone()
            if not wp:
                return json.dumps({"error": "not_found"})
            recent = conn.execute(
                """
                SELECT id, opened_at, classes, status FROM incidents
                 WHERE waypoint_id = ? ORDER BY opened_at DESC LIMIT 10
                """,
                (waypoint_id,),
            ).fetchall()
        out = dict(wp)
        out["targets"] = json.loads(out["targets"])
        out["detection_window"] = json.loads(out["detection_window"])
        out["recent_incidents"] = [
            {**dict(r), "classes": json.loads(r["classes"])} for r in recent
        ]
        return json.dumps({"waypoint": out})

    # ---- @skill: summarize_period ----------------------------------------


    def summarize_period(
        self,
        start: str,
        end: str,
        waypoint_id: Optional[str] = None,
    ) -> str:
        clauses = ["i.opened_at BETWEEN ? AND ?"]
        args: list = [start, end]
        if waypoint_id:
            clauses.append("i.waypoint_id = ?")
            args.append(waypoint_id)
        with self._ro() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) AS n FROM incidents i WHERE {' AND '.join(clauses)}",
                args,
            ).fetchone()["n"]
            # Use json_each to explode the classes array so each element gets
            # its own bucket — avoids `["person"]` vs `["person","vehicle"]`
            # producing separate rows.
            by_class = conn.execute(
                f"""
                SELECT je.value AS class, COUNT(*) AS n
                  FROM incidents i, json_each(i.classes) je
                 WHERE {' AND '.join(clauses)}
              GROUP BY je.value
              ORDER BY n DESC LIMIT 10
                """,
                args,
            ).fetchall()
            by_wp = conn.execute(
                f"""
                SELECT i.waypoint_id, w.name AS waypoint_name, COUNT(*) AS n
                  FROM incidents i LEFT JOIN waypoints w ON w.id = i.waypoint_id
                 WHERE {' AND '.join(clauses)}
              GROUP BY i.waypoint_id
              ORDER BY n DESC
                """,
                args,
            ).fetchall()
        return json.dumps(
            {
                "total": total,
                "by_class": [{"class": r["class"], "n": r["n"]} for r in by_class],
                "by_waypoint": [dict(r) for r in by_wp],
            }
        )

    # ---- @skill: acknowledge_incident ------------------------------------


    def acknowledge_incident(self, incident_id: str, user_handle: str) -> str:
        # This skill *writes*, so it needs a normal (rw) connection.
        conn = sqlite3.connect(self.sqlite_path)
        try:
            now = conn.execute(
                "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')"
            ).fetchone()[0]
            cur = conn.execute(
                """
                UPDATE incidents
                   SET status = 'acknowledged',
                       acknowledged_by_handle = ?,
                       acknowledged_at = ?
                 WHERE id = ?
                """,
                (user_handle, now, incident_id),
            )
            conn.commit()
            return json.dumps({"ok": cur.rowcount > 0})
        finally:
            conn.close()
