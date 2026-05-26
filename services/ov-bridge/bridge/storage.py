"""SQLite writer for the bridge. Single-writer; uses WAL.

The schema mirrors `packages/schemas/src/tables.ts` — the API service owns
migrations, the bridge only does inserts / upserts of operational events.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import structlog

log = structlog.get_logger()


class Storage:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.execute("PRAGMA busy_timeout = 5000")

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Cursor]:
        cur = self._conn.cursor()
        cur.execute("BEGIN")
        try:
            yield cur
            cur.execute("COMMIT")
        except Exception:
            cur.execute("ROLLBACK")
            raise
        finally:
            cur.close()

    def insert_incident_open(self, evt: dict[str, Any]) -> None:
        with self._tx() as cur:
            cur.execute(
                """
                INSERT OR IGNORE INTO incidents (
                  id, waypoint_id, track_id, classes, opened_at, status,
                  inspection_pose_x, inspection_pose_y, clip_status, metadata
                ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, 'pending', '{}')
                """,
                (
                    evt["incident_id"],
                    evt["waypoint_id"],
                    evt.get("track_id"),
                    json.dumps(evt["classes"]),
                    evt["opened_at"],
                    (evt.get("inspection_pose") or {}).get("x"),
                    (evt.get("inspection_pose") or {}).get("y"),
                ),
            )

    def update_incident_close(self, evt: dict[str, Any]) -> None:
        with self._tx() as cur:
            cur.execute(
                """
                UPDATE incidents
                   SET closed_at = ?, status = ?
                 WHERE id = ?
                """,
                (evt["closed_at"], evt["status"], evt["incident_id"]),
            )

    def update_clip_ready(self, evt: dict[str, Any]) -> None:
        with self._tx() as cur:
            cur.execute(
                """
                UPDATE incidents
                   SET clip_path = ?, poster_path = ?, clip_status = 'ready'
                 WHERE id = ?
                """,
                (evt["clip_path"], evt["poster_path"], evt["incident_id"]),
            )

    def upsert_robot_status(self, evt: dict[str, Any]) -> None:
        pose = evt.get("pose") or {}
        with self._tx() as cur:
            cur.execute(
                """
                INSERT INTO robot_status (id, state, current_waypoint_id, last_seen_at, pose_x, pose_y, pose_yaw)
                VALUES (1, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  state = excluded.state,
                  current_waypoint_id = excluded.current_waypoint_id,
                  last_seen_at = excluded.last_seen_at,
                  pose_x = excluded.pose_x, pose_y = excluded.pose_y, pose_yaw = excluded.pose_yaw
                """,
                (
                    evt["state"],
                    evt.get("waypoint_id"),
                    evt["ts"],
                    pose.get("x"),
                    pose.get("y"),
                    pose.get("yaw"),
                ),
            )

    def insert_detections(self, ts: str, detections: list[dict[str, Any]]) -> None:
        # Downsample: only persist if we have an open incident at this moment
        # (we still broadcast all detections over WS).
        with self._tx() as cur:
            cur.execute("SELECT id FROM incidents WHERE status = 'open'")
            open_ids = [row[0] for row in cur.fetchall()]
            if not open_ids:
                return
            for det in detections:
                for iid in open_ids:
                    cur.execute(
                        """
                        INSERT INTO detections (ts, class, confidence, bbox, track_id, incident_id)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            ts,
                            det["class"],
                            det["confidence"],
                            json.dumps(det["bbox"]),
                            det.get("track_id"),
                            iid,
                        ),
                    )

    def upsert_waypoint(self, evt: dict[str, Any]) -> None:
        pose = evt["pose"]
        if evt["action"] == "delete":
            with self._tx() as cur:
                cur.execute("DELETE FROM waypoints WHERE id = ?", (evt["waypoint_id"],))
            return
        with self._tx() as cur:
            cur.execute(
                """
                INSERT INTO waypoints (
                  id, name, pose_x, pose_y, pose_yaw, scene_description, targets,
                  detection_window, linger_threshold_seconds, inspection_dwell_seconds,
                  min_standoff_m, order_index, enabled, created_at
                ) VALUES (?, ?, ?, ?, ?, '', '[]', '{"type":"always"}', 5, 4, 1.5,
                         COALESCE((SELECT MAX(order_index)+1 FROM waypoints), 0), 1,
                         strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  pose_x = excluded.pose_x, pose_y = excluded.pose_y, pose_yaw = excluded.pose_yaw
                """,
                (evt["waypoint_id"], evt["name"], pose["x"], pose["y"], pose["yaw"]),
            )

    def close(self) -> None:
        self._conn.close()
