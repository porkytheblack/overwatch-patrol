"""LCM listener.

LCM is an optional runtime dependency: if the `lcm` package isn't installed
(common in CI / Mac dev), the bridge still runs — it just serves WS/HTTP
with no incoming events. The robot host installs `lcm` and gets the full
ingestion path.
"""
from __future__ import annotations

import asyncio
import json
from typing import Awaitable, Callable

import structlog

log = structlog.get_logger()

EventHandler = Callable[[str, dict], Awaitable[None]]

OW_TOPICS = (
    "/ow/detections",
    "/ow/robot_state",
    "/ow/incident_opened",
    "/ow/incident_closed",
    "/ow/clip_ready",
    "/ow/waypoint_sync",
)


class LcmListener:
    def __init__(self, url: str, on_event: EventHandler) -> None:
        self.url = url
        self.on_event = on_event
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            await self._task

    async def _run(self) -> None:
        try:
            import lcm  # type: ignore
            from dimos_lcm.std_msgs import String  # type: ignore
        except Exception as e:  # noqa: BLE001
            log.warning("lcm.unavailable", error=str(e),
                        note="bridge serves WS/HTTP only; install `lcm` on the robot host")
            await self._stop.wait()
            return

        loop = asyncio.get_running_loop()
        lc = lcm.LCM(self.url)

        def _make_handler(topic: str):
            def _handler(_channel: str, data: bytes) -> None:
                try:
                    msg = String.decode(data)
                    payload = json.loads(msg.data)
                except Exception as e:  # noqa: BLE001
                    log.warning("lcm.decode_fail", topic=topic, error=str(e))
                    return
                asyncio.run_coroutine_threadsafe(self.on_event(topic, payload), loop)
            return _handler

        for t in OW_TOPICS:
            lc.subscribe(t, _make_handler(t))
        log.info("lcm.subscribed", topics=OW_TOPICS, url=self.url)

        # Pump LCM in a thread so we don't block the event loop.
        import threading

        def _pump() -> None:
            while not self._stop.is_set():
                try:
                    lc.handle_timeout(200)
                except Exception as e:  # noqa: BLE001
                    log.error("lcm.handle_error", error=str(e))

        t = threading.Thread(target=_pump, daemon=True, name="lcm-pump")
        t.start()
        await self._stop.wait()
