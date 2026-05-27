"""go2_overwatch — full robot stack composition.

Composes dimos's Go2 navigation stack with our extension modules
(SurveillanceModule, ClipRecorderModule, SurveillanceQueryModule) plus
the dimos `McpServer` so every `@skill` is reachable at
`http://robot:9990/mcp`.

Run with `make robot` (real Go2, requires `ROBOT_IP`) or `make sim`
(Mujoco, `OV_SIM=1`).

We deliberately use `unitree_go2` (navigation + costmap + planning) instead
of `unitree_go2_spatial`. The spatial blueprint pulls in dimos's
`SecurityModule` (CUDA-only EdgeTAM segmenter) and `SpatialMemory` (CLIP
embeddings) which we don't need — our `SurveillanceModule` is the
v1-spec surveillance brain, and SpatialMemory is reserved for v2.
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path


def _load_dotenv() -> None:
    """Load `.env` from the repo root so make-targets pick up secrets.

    Walks up from this file looking for a marker that says repo root.
    Without this, `make sim` runs `python -m ...` with whatever env the
    shell has, and OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY
    set in .env never reach dimos's internal McpClient (which uses
    langchain's init_chat_model() and defaults to OpenAI).
    """
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / ".env"
        if candidate.exists() and (parent / "pnpm-workspace.yaml").exists():
            try:
                from dotenv import load_dotenv  # type: ignore

                load_dotenv(candidate)
                sys.stderr.write(f"[blueprint] loaded .env from {candidate}\n")
            except Exception as e:  # noqa: BLE001
                sys.stderr.write(f"[blueprint] could not load .env: {e}\n")
            return


def main() -> None:
    _load_dotenv()

    try:
        from dimos.agents.mcp.mcp_client import McpClient
        from dimos.agents.mcp.mcp_server import McpServer
        from dimos.core.coordination.blueprints import autoconnect
        from dimos.core.coordination.module_coordinator import ModuleCoordinator
        from dimos.robot.unitree.go2.blueprints.smart.unitree_go2 import unitree_go2
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

    # ── git-lfs preflight ───────────────────────────────────────────────
    # (Even without SpatialMemory / SecurityModule the perception loop may
    # still pull a small model — keep the check.)
    if shutil.which("git-lfs") is None:
        sys.stderr.write(
            "git-lfs not found on PATH.\n"
            "Install: `brew install git-lfs && git lfs install` (macOS) /\n"
            "         `sudo apt-get install -y git-lfs && git lfs install` (Ubuntu)\n",
        )
        sys.exit(1)

    # ── sim vs real-hardware switching ──────────────────────────────────
    # `simulation` and `robot_ip` must be passed via blueprint_args["g"]
    # so they reach the worker subprocesses (a main-process
    # global_config.update() doesn't propagate).
    sim = os.environ.get("OV_SIM", "").lower() in ("1", "true", "yes")
    g_overrides: dict = {}
    if sim:
        g_overrides["simulation"] = True
        sys.stderr.write("[blueprint] OV_SIM=1 → MujocoConnection\n")
    else:
        robot_ip = os.environ.get("ROBOT_IP")
        if not robot_ip:
            sys.stderr.write(
                "ROBOT_IP not set — pointing the blueprint at real hardware will\n"
                "fail without it. Set ROBOT_IP=<your Go2 IP> or run `make sim`.\n",
            )
            sys.exit(1)
        g_overrides["robot_ip"] = robot_ip

    from overwatch_patrol.clip_recorder import ClipRecorderModule
    from overwatch_patrol.local_speak_skill import LocalSpeakSkill
    from overwatch_patrol.query_module import SurveillanceQueryModule
    from overwatch_patrol.spatial_memory_stub import SpatialMemoryStub
    from overwatch_patrol.surveillance_module import SurveillanceModule

    sqlite_path = os.environ.get("SQLITE_PATH", "/data/overwatch.db")
    clip_dir = os.environ.get("CLIP_DIR", "/data/clips")

    # TTS selection — agent always gets a `speak(...)` tool:
    #   OPENAI_API_KEY set → dimos SpeakSkill (cloud, high-quality voice)
    #   otherwise          → LocalSpeakSkill (offline, OS native TTS)
    if os.environ.get("OPENAI_API_KEY"):
        speak_blueprint = SpeakSkill.blueprint()
        sys.stderr.write("[blueprint] OPENAI_API_KEY set → SpeakSkill (OpenAI TTS).\n")
    else:
        speak_blueprint = LocalSpeakSkill.blueprint()
        sys.stderr.write(
            "[blueprint] OPENAI_API_KEY unset → LocalSpeakSkill (offline OS TTS).\n",
        )

    go2_overwatch = autoconnect(
        _with_jpeglcm,
        unitree_go2,
        # In-memory stub satisfies the SpatialMemorySpec that
        # NavigationSkillContainer requires, without needing CLIP / ChromaDB
        # (which require a CUDA GPU and a writable assets dir).
        SpatialMemoryStub.blueprint(),
        SurveillanceModule.blueprint(camera_info=GO2Connection.camera_info_static),
        ClipRecorderModule.blueprint(output_dir=clip_dir),
        SurveillanceQueryModule.blueprint(sqlite_path=sqlite_path),
        NavigationSkillContainer.blueprint(),
        PersonFollowSkillContainer.blueprint(camera_info=GO2Connection.camera_info_static),
        UnitreeSkillContainer.blueprint(),
        speak_blueprint,
        McpServer.blueprint(),
        McpClient.blueprint(),
    )

    coordinator = ModuleCoordinator.build(go2_overwatch, {"g": g_overrides})
    coordinator.start_rpyc_service()
    coordinator.loop()


if __name__ == "__main__":
    main()
