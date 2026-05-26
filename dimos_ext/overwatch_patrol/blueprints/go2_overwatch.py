"""go2_overwatch — full robot stack composition.

Composes dimos's `unitree_go2_spatial` blueprint with our extension modules,
plus the dimos `McpServer` so every `@skill` (control + read-only queries)
is reachable at `http://robot:9990/mcp`.

Run with `make robot` (or `make sim` for the Mujoco connection).

This file imports dimos eagerly because it's the robot entry point — there's
no scenario where you run this without dimos. For non-dimos environments
(CI, unit tests), import the individual modules (`surveillance_module`,
`query_module`, etc.) instead.
"""
from __future__ import annotations

import os
import sys


def main() -> None:
    try:
        from dimos.agents.mcp.mcp_client import McpClient
        from dimos.agents.mcp.mcp_server import McpServer
        from dimos.core.coordination.blueprints import autoconnect
        from dimos.robot.unitree.go2.blueprints.smart.unitree_go2_spatial import (
            unitree_go2_spatial,
        )
        from dimos.robot.unitree.go2.blueprints.smart._with_jpeg import _with_jpeglcm
        from dimos.agents.skills.navigation import NavigationSkillContainer
        from dimos.agents.skills.person_follow import PersonFollowSkillContainer
        from dimos.agents.skills.speak_skill import SpeakSkill
        from dimos.robot.unitree.unitree_skill_container import UnitreeSkillContainer
        from dimos.robot.unitree.go2.connection import GO2Connection
    except ImportError as e:
        sys.stderr.write(
            "dimos imports failed — make sure `vendor/dimos` is present and `make setup` ran.\n"
            f"  underlying error: {e}\n"
        )
        sys.exit(1)

    from overwatch_patrol.clip_recorder import ClipRecorderModule
    from overwatch_patrol.query_module import SurveillanceQueryModule
    from overwatch_patrol.surveillance_module import SurveillanceModule

    sqlite_path = os.environ.get("SQLITE_PATH", "/data/overwatch.db")
    clip_dir = os.environ.get("CLIP_DIR", "/data/clips")

    go2_overwatch = autoconnect(
        _with_jpeglcm,
        unitree_go2_spatial,
        SurveillanceModule.blueprint(camera_info=GO2Connection.camera_info_static),  # type: ignore[attr-defined]
        ClipRecorderModule.blueprint(output_dir=clip_dir),  # type: ignore[attr-defined]
        SurveillanceQueryModule.blueprint(sqlite_path=sqlite_path),  # type: ignore[attr-defined]
        NavigationSkillContainer.blueprint(),
        PersonFollowSkillContainer.blueprint(camera_info=GO2Connection.camera_info_static),
        UnitreeSkillContainer.blueprint(),
        SpeakSkill.blueprint(),
        McpServer.blueprint(),
        McpClient.blueprint(),
    )

    # dimos blueprints expose `.run()` (or compatible) via `autoconnect`.
    go2_overwatch.run()


if __name__ == "__main__":
    main()
