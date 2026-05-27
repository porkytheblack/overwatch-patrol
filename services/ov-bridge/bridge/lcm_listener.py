"""LCM listener.

LCM is an optional runtime dependency: if the `lcm` package isn't installed
(common in CI / Mac dev), the bridge still runs — it just serves WS/HTTP
with no incoming events. The robot host installs `lcm` and gets the full
ingestion path.
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional

import structlog

from .frame_hub import FrameHub

# Wordmark "amber pulse" indicator (spec §0) needs a signal that LCM is
# flowing from the robot. /color_image arrives every frame (~14Hz) while
# /ow/* events fire only on state transitions; rather than burn WS
# bandwidth at video rate, the image handler synthesizes a heartbeat at
# most once per second.
HEARTBEAT_TOPIC = "/ow/heartbeat"
HEARTBEAT_MIN_INTERVAL_S = 1.0

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

# dimos's `LCMPubSubBase.subscribe` derives the LCM channel from
# `Topic(topic, lcm_type)` as `{topic}#{type.msg_name}`. So when the
# blueprint composes `JpegLcmTransport("/color_image", Image)`, frames
# land on `/color_image#sensor_msgs.Image` — and a raw subscription to
# `/color_image` matches nothing. We use a regex that catches both the
# bare and the type-suffixed forms.
IMAGE_TOPIC_REGEX = r"^/color_image(#.*)?$"


class LcmListener:
    def __init__(
        self,
        url: str,
        on_event: EventHandler,
        frames: Optional[FrameHub] = None,
    ) -> None:
        self.url = url
        self.on_event = on_event
        self.frames = frames
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

        # Image decoder is optional — the bridge can still ingest /ow/*
        # events even if the JPEG bindings are missing.
        LCMImage = None
        if self.frames is not None:
            try:
                from dimos_lcm.sensor_msgs.Image import Image as _LCMImage  # type: ignore
                LCMImage = _LCMImage
            except Exception as e:  # noqa: BLE001
                log.warning("lcm.image_msg_missing", error=str(e),
                            note="MJPEG endpoint will idle without a frame source")

        loop = asyncio.get_running_loop()
        lc = lcm.LCM(self.url)

        def _make_ow_handler(topic: str):
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
            lc.subscribe(t, _make_ow_handler(t))

        if LCMImage is not None and self.frames is not None:
            frames = self.frames
            heartbeat_state = {"last": 0.0}

            def _image_handler(_channel: str, data: bytes) -> None:
                try:
                    msg = LCMImage.lcm_decode(data)
                except Exception as e:  # noqa: BLE001
                    log.warning("lcm.image_decode_fail", error=str(e))
                    return
                if getattr(msg, "encoding", "") != "jpeg":
                    return
                jpeg = bytes(msg.data[: msg.data_length])
                frames.publish_threadsafe(jpeg, loop)

                now = time.monotonic()
                if now - heartbeat_state["last"] >= HEARTBEAT_MIN_INTERVAL_S:
                    heartbeat_state["last"] = now
                    payload = {
                        "type": "robot.heartbeat",
                        "ts": datetime.now(timezone.utc).isoformat(),
                    }
                    asyncio.run_coroutine_threadsafe(
                        self.on_event(HEARTBEAT_TOPIC, payload), loop,
                    )

            lc.subscribe(IMAGE_TOPIC_REGEX, _image_handler)
            log.info("lcm.subscribed_image", topic=IMAGE_TOPIC_REGEX)

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
