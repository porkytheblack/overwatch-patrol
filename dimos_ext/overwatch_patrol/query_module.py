"""SurveillanceQueryModule — read-only SQLite tools, exposed via dimos `@skill`.

These are the agent's read tools. The ov-telegram bot connects through the
same MCP server and gets them in the model's tool list alongside the
surveillance control skills.

Returns JSON strings so the model can parse uniformly.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator, Literal, Optional


@dataclass
class SurveillanceQueryModule:
    sqlite_path: str

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
            robot = conn.execute("SELECT * FROM robot_status WHERE id = 1").fetchone()
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
        return json.dumps(
            {
                "robot": dict(robot) if robot else None,
                "open_incident_count": open_count["n"],
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
        clauses = ["opened_at BETWEEN ? AND ?"]
        args: list = [start, end]
        if waypoint_id:
            clauses.append("waypoint_id = ?")
            args.append(waypoint_id)
        with self._ro() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) AS n FROM incidents WHERE {' AND '.join(clauses)}",
                args,
            ).fetchone()["n"]
            by_class = conn.execute(
                f"""
                SELECT classes, COUNT(*) AS n FROM incidents WHERE {' AND '.join(clauses)}
                GROUP BY classes ORDER BY n DESC LIMIT 10
                """,
                args,
            ).fetchall()
            by_wp = conn.execute(
                f"""
                SELECT waypoint_id, COUNT(*) AS n FROM incidents WHERE {' AND '.join(clauses)}
                GROUP BY waypoint_id ORDER BY n DESC
                """,
                args,
            ).fetchall()
        return json.dumps(
            {
                "total": total,
                "by_class": [
                    {"classes": json.loads(r["classes"]), "n": r["n"]} for r in by_class
                ],
                "by_waypoint": [dict(r) for r in by_wp],
            }
        )

    # ---- @skill: acknowledge_incident ------------------------------------

    def acknowledge_incident(self, incident_id: str, user_handle: str) -> str:
        # NOTE: this *writes*, so it doesn't open the connection read-only.
        conn = sqlite3.connect(self.sqlite_path)
        try:
            now = sqlite3.Connection.execute(conn, "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')").fetchone()[0]
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
