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

    # Default viewer to "none" BEFORE any dimos import.
    #
    # `unitree_go2_basic` evaluates `global_config.viewer` at import time
    # to decide whether to compose `RerunBridgeModule`. That module
    # subscribes to all LCM topics via a plain `LCM()` pubsub and routes
    # every payload through `Image.lcm_decode`, which raises
    # `ValueError: Unsupported encoding: jpeg` for every JPEG-encoded
    # frame our `_with_jpeglcm` transport publishes. The dashboard's
    # LiveTile IS the operator's viewer here, so rerun is redundant.
    #
    # Operator opt-in: export VIEWER=rerun before `make sim` / `make
    # robot` — pair with disabling _with_jpeglcm or accept the decode
    # noise.
    os.environ.setdefault("VIEWER", "none")
    if os.environ.get("VIEWER") == "none":
        sys.stderr.write(
            "[blueprint] VIEWER=none → dimos rerun bridge disabled "
            "(live view is in the dashboard).\n",
        )

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
    g_overrides: dict = {"viewer": os.environ.get("VIEWER", "none")}
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

    # /data/* paths are Docker-mounted in compose, non-existent on a Mac
    # host. Mirror the same remap the bridge does (ov-bridge/config.py)
    # so `make sim` / `make robot` on a developer Mac just works.
    def _remap_data_path(p: str) -> str:
        if not (p.startswith("/data/") or p == "/data"):
            return p
        # /data isn't writable here → use <repoRoot>/data/<basename or rest>
        here = Path(__file__).resolve()
        for parent in here.parents:
            if (parent / "pnpm-workspace.yaml").exists():
                repo_root = parent
                break
        else:
            repo_root = Path.cwd()
        rest = p[len("/data/"):] if p.startswith("/data/") else ""
        remapped = repo_root / "data" / rest
        try:
            remapped.parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        sys.stderr.write(
            f"[blueprint] remapped {p!r} → {str(remapped)!r}\n",
        )
        return str(remapped)

    if not os.access("/data", os.W_OK):
        sqlite_path = _remap_data_path(sqlite_path)
        clip_dir = _remap_data_path(clip_dir)
    # Expose the remapped paths to child threads / modules through env
    # so `_load_waypoints_from_sqlite` and any other consumer agrees.
    os.environ["SQLITE_PATH"] = sqlite_path
    os.environ["CLIP_DIR"] = clip_dir

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

    # `_with_jpeglcm` IS `unitree_go2` with a JpegLcmTransport overriding the
    # default `color_image` transport. Don't pass plain `unitree_go2` again
    # afterwards — dimos's `autoconnect` merges transport_maps in order with
    # "later wins", so `unitree_go2`'s pSHMTransport (on Mac) would silently
    # clobber the JPEG-over-LCM override and our bridge would never see
    # `/color_image` frames.
    # Override GO2Connection's mode to RAGE. This is the canonical dimos
    # pattern (see dimos/robot/unitree/go2/blueprints/basic/
    # unitree_go2_webrtc_rage_keyboard_teleop.py) for enabling joystick
    # walking via the WebRTC channel. In RAGE mode, GO2Connection.start()
    # calls enable_rage_mode() which fires the two sport commands the
    # dog actually needs:
    #
    #   1. api_id 2059 ({"data": True})    — rage toggle, uncaps motion
    #   2. SwitchJoystick (1027, {"data": True}) — flips WIRELESS_CONTROLLER
    #      interpretation from "body posture" to "walking direction"
    #
    # Without RAGE mode, the dog is in BalanceStand where the left
    # stick adjusts body height/pitch instead of walking. Symptom:
    # pressing W on the dashboard lifts the body up; S lowers it.
    #
    # autoconnect's "later wins" rule on module identity means this
    # second GO2Connection.blueprint replaces the default-mode one from
    # `_with_jpeglcm`. The JpegLcmTransport from _with_jpeglcm survives
    # because we don't override the transport_map here.
    go2_overwatch = autoconnect(
        _with_jpeglcm,
        GO2Connection.blueprint(mode="rage"),
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
