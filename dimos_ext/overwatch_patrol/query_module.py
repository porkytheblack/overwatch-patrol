"""SurveillanceQueryModule — dimos `Module` wrapper around `SurveillanceQueryCore`.

Six read-only `@skill`s the agent uses through the dimos MCP server.
SQLite is opened in read-only mode (`?mode=ro`) to avoid lock contention
with ov-bridge writes (spec §7.4).
"""
from __future__ import annotations

from typing import Any

import structlog

from dimos.agents.annotation import skill
from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig

from .query_core import SurveillanceQueryCore

log = structlog.get_logger()


class SurveillanceQueryModuleConfig(ModuleConfig):
    sqlite_path: str = "/data/overwatch.db"


class SurveillanceQueryModule(Module):
    config: SurveillanceQueryModuleConfig

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.core = SurveillanceQueryCore(sqlite_path=self.config.sqlite_path)

    @rpc
    def start(self) -> None:
        super().start()
        log.info("query_module.started", sqlite=self.config.sqlite_path)

    @rpc
    def stop(self) -> None:
        super().stop()

    # ---- Skills exposed to the agent (spec §7.4) -------------------------

    @rpc
    @skill
    def search_incidents(
        self,
        time_range_start: str,
        time_range_end: str,
        classes: list[str] | None = None,
        waypoint_id: str | None = None,
        status: str = "all",
        limit: int = 20,
    ) -> str:
        """Search incidents in a time window with optional filters. Returns JSON."""
        return self.core.search_incidents(
            time_range_start, time_range_end, classes, waypoint_id, status, limit  # type: ignore[arg-type]
        )

    @rpc
    @skill
    def get_incident_details(self, incident_id: str) -> str:
        """Full detail + detection track history for one incident."""
        return self.core.get_incident_details(incident_id)

    @rpc
    @skill
    def get_compound_status(self) -> str:
        """Robot state, current waypoint, detector fps, open-incident count, recent activity."""
        return self.core.get_compound_status()

    @rpc
    @skill
    def get_waypoint_context(self, waypoint_id: str) -> str:
        """Full waypoint definition + last 10 incidents at that waypoint."""
        return self.core.get_waypoint_context(waypoint_id)

    @rpc
    @skill
    def summarize_period(
        self,
        start: str,
        end: str,
        waypoint_id: str | None = None,
    ) -> str:
        """Aggregate incident counts over a time window, by class and by waypoint."""
        return self.core.summarize_period(start, end, waypoint_id)

    @rpc
    @skill
    def acknowledge_incident(self, incident_id: str, user_handle: str) -> str:
        """Mark an incident acknowledged by a Telegram handle."""
        return self.core.acknowledge_incident(incident_id, user_handle)
