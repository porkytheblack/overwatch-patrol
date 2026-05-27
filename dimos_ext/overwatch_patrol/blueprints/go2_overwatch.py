"""go2_overwatch — full robot stack composition.

Composes dimos's `unitree_go2_spatial` blueprint with our extension modules,
plus the dimos `McpServer` so every `@skill` (control + read-only queries)
is reachable at `http://robot:9990/mcp`.

Run with `make robot` (real Go2, requires `ROBOT_IP`) or `make sim` (Mujoco).

Prereqs: dimos installed (`make setup` / `make setup-sim`) and git-lfs on
PATH (dimos's SpatialMemory + SecurityModule fetch CLIP / YOLO weights via
git-lfs on first launch). On macOS: `brew install git-lfs`.
"""
from __future__ import annotations

import os
import shutil
import sys


def main() -> None:
    try:
        from dimos.agents.mcp.mcp_client import McpClient
        from dimos.agents.mcp.mcp_server import McpServer
        from dimos.core.coordination.blueprints import autoconnect
        from dimos.core.coordination.module_coordinator import ModuleCoordinator
        from dimos.core.global_config import global_config
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
            "dimos imports failed — install with: `uv pip install 'dimos[base,unitree]'`\n"
            "or run `make setup`.\n"
            f"  underlying error: {e}\n"
        )
        sys.exit(1)

    # ── git-lfs preflight ────────────────────────────────────────────────
    if shutil.which("git-lfs") is None:
        sys.stderr.write(
            "git-lfs not found on PATH.\n"
            "dimos fetches model weights (CLIP, YOLO) via git-lfs on first launch.\n"
            "Install:\n"
            "  macOS:    brew install git-lfs && git lfs install\n"
            "  Ubuntu:   sudo apt-get install -y git-lfs && git lfs install\n",
        )
        sys.exit(1)

    # ── sim vs real-hardware switching ───────────────────────────────────
    sim = os.environ.get("OV_SIM", "").lower() in ("1", "true", "yes")
    if sim:
        global_config.update(simulation=True)
        sys.stderr.write("[blueprint] OV_SIM=1 → MujocoConnection\n")
    else:
        robot_ip = os.environ.get("ROBOT_IP")
        if not robot_ip:
            sys.stderr.write(
                "ROBOT_IP not set — pointing the blueprint at real hardware will\n"
                "fail without it. Set ROBOT_IP=<your Go2 IP> or run `make sim`.\n",
            )
            sys.exit(1)
        global_config.update(robot_ip=robot_ip)

    from overwatch_patrol.clip_recorder import ClipRecorderModule
    from overwatch_patrol.query_module import SurveillanceQueryModule
    from overwatch_patrol.surveillance_module import SurveillanceModule

    sqlite_path = os.environ.get("SQLITE_PATH", "/data/overwatch.db")
    clip_dir = os.environ.get("CLIP_DIR", "/data/clips")

    go2_overwatch = autoconnect(
        _with_jpeglcm,
        unitree_go2_spatial,
        SurveillanceModule.blueprint(camera_info=GO2Connection.camera_info_static),
        ClipRecorderModule.blueprint(output_dir=clip_dir),
        SurveillanceQueryModule.blueprint(sqlite_path=sqlite_path),
        NavigationSkillContainer.blueprint(),
        PersonFollowSkillContainer.blueprint(camera_info=GO2Connection.camera_info_static),
        UnitreeSkillContainer.blueprint(),
        SpeakSkill.blueprint(),
        McpServer.blueprint(),
        McpClient.blueprint(),
    )

    coordinator = ModuleCoordinator.build(go2_overwatch)
    coordinator.start_rpyc_service()
    coordinator.loop()


if __name__ == "__main__":
    main()
