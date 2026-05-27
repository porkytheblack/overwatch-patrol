from __future__ import annotations

import asyncio
import signal

from aiohttp import web
import structlog

from .cmd_vel import CmdVelPublisher
from .config import Config
from .frame_hub import FrameHub
from .lcm_listener import LcmListener
from .logging_setup import setup_logging
from .sport_pub import SportPublisher
from .storage import Storage
from .ws_server import WsHub, make_app


async def run(cfg: Config) -> None:
    log = structlog.get_logger()
    storage = Storage(cfg.sqlite_path)
    hub = WsHub()
    frames = FrameHub()
    cmd_vel = CmdVelPublisher(lcm_url=cfg.lcm_url)
    sport_pub = SportPublisher(lcm_url=cfg.lcm_url)

    async def dispatch(topic: str, payload: dict) -> None:
        event_type = payload.get("type") or topic
        log.info("event", topic=topic, type=event_type)
        try:
            if topic == "/ow/incident_opened":
                storage.insert_incident_open(payload)
            elif topic == "/ow/incident_closed":
                storage.update_incident_close(payload)
            elif topic == "/ow/clip_ready":
                changes = storage.update_clip_ready(payload)
                log.info(
                    "clip_ready.applied",
                    incident_id=payload.get("incident_id"),
                    clip_path=payload.get("clip_path"),
                    rows_updated=changes,
                )
                if changes == 0:
                    log.warning(
                        "clip_ready.no_match",
                        incident_id=payload.get("incident_id"),
                        note="incident_id not found in SQLite — possible bridge restart "
                        "between incident_opened and clip.ready",
                    )
            elif topic == "/ow/robot_state":
                storage.upsert_robot_status(payload)
            elif topic == "/ow/detections":
                storage.insert_detections(payload["ts"], payload["detections"])
            elif topic == "/ow/waypoint_sync":
                storage.upsert_waypoint(payload)
        except Exception as e:  # noqa: BLE001
            log.exception("storage.error", topic=topic, error=str(e))
        await hub.broadcast(payload)

    # Restart recovery (spec §7.5 DoD): surface incidents still waiting for clips.
    try:
        pending = storage.load_pending_incidents()
        if pending:
            log.info("bridge.recovered_pending", count=len(pending), ids=pending[:10])
    except Exception as e:  # noqa: BLE001
        log.warning("bridge.recovery_failed", error=str(e))

    listener = LcmListener(cfg.lcm_url, dispatch, frames=frames)
    await listener.start()

    app = make_app(
        hub, storage, frames=frames, cmd_vel=cmd_vel, sport_pub=sport_pub,
    )
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", cfg.ws_port)
    await site.start()
    log.info("bridge.ready", ws_port=cfg.ws_port, sqlite=cfg.sqlite_path)

    stop = asyncio.Event()

    def _on_signal() -> None:
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _on_signal)
        except NotImplementedError:
            pass

    await stop.wait()
    log.info("bridge.shutdown")
    await listener.stop()
    await runner.cleanup()
    storage.close()


def main() -> None:
    cfg = Config.from_env()
    setup_logging(cfg.log_level)
    asyncio.run(run(cfg))


if __name__ == "__main__":
    main()
