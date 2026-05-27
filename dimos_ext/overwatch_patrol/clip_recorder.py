"""ClipRecorderModule — dimos `Module` wrapper around `ClipRecorderCore`.

Drives the recorder end-to-end:

- LCM subscriber for /color_image (JPEG via _with_jpeglcm). Each frame
  is decoded → resized to config.width×height → handed to the core's
  rolling buffer as raw bgr24 bytes that ffmpeg accepts directly.
- LCM subscriber for /ow/detections, /ow/incident_opened,
  /ow/incident_closed (std_msgs.String JSON, matching the rest of the
  /ow/* topics).
- Periodic tick at 2 Hz drives the post_roll close timer and finalises
  finished clips.
- /ow/clip_ready publish — same raw LCM + std_msgs.String JSON path
  the bridge already subscribes to.

The pure logic stays in `clip_recorder_core.ClipRecorderCore`. This
file is the dimos-coupled adapter, mirroring the surveillance_module
pattern.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any, Optional

import structlog

from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig

from .clip_recorder_core import ClipRecorderConfig, ClipRecorderCore

log = structlog.get_logger()


class ClipRecorderModuleConfig(ModuleConfig):
    output_dir: str = "/data/clips"
    pre_roll_s: float = 5.0
    post_roll_s: float = 10.0
    fps: int = 15
    width: int = 1280
    height: int = 720


class ClipRecorderModule(Module):
    config: ClipRecorderModuleConfig

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        # CLIP_DIR may have been remapped by the blueprint when /data
        # isn't writable (Mac host). Prefer that env value over the
        # blueprint-baked default.
        output_dir = os.environ.get("CLIP_DIR", self.config.output_dir)
        self.core = ClipRecorderCore(
            config=ClipRecorderConfig(
                output_dir=output_dir,
                pre_roll_s=self.config.pre_roll_s,
                post_roll_s=self.config.post_roll_s,
                fps=self.config.fps,
                width=self.config.width,
                height=self.config.height,
            ),
        )
        self.core.publish_lcm = self._publish_lcm
        self._lc_pub: Optional[Any] = None
        self._start_threads()

    @rpc
    def start(self) -> None:
        super().start()
        log.info("clip_recorder.module.started", output_dir=self.core.config.output_dir)

    @rpc
    def stop(self) -> None:
        log.info("clip_recorder.module.stopped")
        super().stop()

    # ------------------------------------------------------------------
    # LCM publish — `/ow/clip_ready` as std_msgs.String JSON, matching
    # the surveillance module's `_publish_event` pattern.
    # ------------------------------------------------------------------

    def _publish_lcm(self, topic: str, payload: dict) -> None:
        try:
            if self._lc_pub is None:
                import lcm  # type: ignore

                self._lc_pub = lcm.LCM(
                    os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
                )
            from dimos_lcm.std_msgs.String import String  # type: ignore

            msg = String(data=json.dumps(payload, separators=(",", ":")))
            self._lc_pub.publish(topic, msg.lcm_encode())
            log.info("clip_recorder.published", topic=topic, type=payload.get("type"))
        except Exception as e:  # noqa: BLE001
            log.warning("clip_recorder.publish_fail", topic=topic, error=str(e))

    # ------------------------------------------------------------------
    # LCM ingestion + periodic close + finalize.
    # ------------------------------------------------------------------

    def _start_threads(self) -> None:
        import threading

        threading.Thread(
            target=self._run_image_listener,
            daemon=True,
            name="clip-recorder-image",
        ).start()
        threading.Thread(
            target=self._run_event_listener,
            daemon=True,
            name="clip-recorder-events",
        ).start()
        threading.Thread(
            target=self._run_tick,
            daemon=True,
            name="clip-recorder-tick",
        ).start()

    def _run_image_listener(self) -> None:
        try:
            import lcm  # type: ignore
            import numpy as np  # type: ignore
            import cv2  # type: ignore
            from dimos_lcm.sensor_msgs.Image import Image as LCMImage  # type: ignore
        except Exception as e:  # noqa: BLE001
            log.warning("clip_recorder.image_imports_failed", error=str(e))
            return

        w, h = self.core.config.width, self.core.config.height
        log.info("clip_recorder.image_listener_alive", width=w, height=h)

        def _handler(_ch: str, data: bytes) -> None:
            try:
                msg = LCMImage.lcm_decode(data)
                if getattr(msg, "encoding", "") != "jpeg":
                    return
                jpeg = bytes(msg.data[: msg.data_length])
            except Exception as e:  # noqa: BLE001
                log.warning("clip_recorder.image_decode_fail", error=str(e))
                return
            try:
                arr = cv2.imdecode(
                    np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR,
                )
                if arr is None:
                    return
                # Resize to the ffmpeg pipe's expected geometry. The
                # Mujoco camera comes in at ~640×480 by default; the
                # real Go2 is typically 1280×720. Resize is cheap and
                # keeps the writer side stable.
                if arr.shape[1] != w or arr.shape[0] != h:
                    arr = cv2.resize(arr, (w, h), interpolation=cv2.INTER_AREA)
                self.core.on_frame(time.time(), arr.tobytes())
            except Exception as e:  # noqa: BLE001
                log.warning("clip_recorder.frame_handle_fail", error=str(e))

        lc = lcm.LCM(
            os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
        )
        lc.subscribe(r"^/color_image(#.*)?$", _handler)
        log.info("clip_recorder.image_lcm_subscribed")
        while True:
            try:
                lc.handle_timeout(200)
            except Exception:  # noqa: BLE001
                return

    def _run_event_listener(self) -> None:
        try:
            import lcm  # type: ignore
            from dimos_lcm.std_msgs.String import String  # type: ignore
        except Exception as e:  # noqa: BLE001
            log.warning("clip_recorder.event_imports_failed", error=str(e))
            return

        log.info("clip_recorder.event_listener_alive")

        def _make_handler(topic: str):
            def _handler(_ch: str, data: bytes) -> None:
                try:
                    msg = String.lcm_decode(data)
                    payload = json.loads(msg.data)
                except Exception as e:  # noqa: BLE001
                    log.warning(
                        "clip_recorder.event_decode_fail",
                        topic=topic,
                        error=str(e),
                    )
                    return
                try:
                    if topic == "/ow/detections":
                        # Spec §6: { type, ts, detections }
                        ts_iso = payload.get("ts")
                        ts = _iso_to_epoch(ts_iso) or time.time()
                        self.core.on_detections(ts, payload.get("detections") or [])
                    elif topic == "/ow/incident_opened":
                        iid = payload.get("incident_id")
                        if iid:
                            log.info("clip_recorder.opening", incident_id=iid)
                            self.core.on_incident_opened(iid)
                    elif topic == "/ow/incident_closed":
                        iid = payload.get("incident_id")
                        if iid:
                            log.info("clip_recorder.closing", incident_id=iid)
                            self.core.on_incident_closed(iid)
                except Exception as e:  # noqa: BLE001
                    log.warning(
                        "clip_recorder.event_handle_fail",
                        topic=topic,
                        error=str(e),
                    )
            return _handler

        lc = lcm.LCM(
            os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
        )
        for t in (
            "/ow/detections",
            "/ow/incident_opened",
            "/ow/incident_closed",
        ):
            lc.subscribe(t, _make_handler(t))
        while True:
            try:
                lc.handle_timeout(200)
            except Exception:  # noqa: BLE001
                return

    def _run_tick(self) -> None:
        log.info("clip_recorder.tick_thread_alive")
        while True:
            try:
                self.core.tick(time.time())
            except Exception as e:  # noqa: BLE001
                log.warning("clip_recorder.tick_fail", error=str(e))
            time.sleep(0.5)


def _iso_to_epoch(s: Optional[str]) -> Optional[float]:
    if not s:
        return None
    try:
        from datetime import datetime

        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:  # noqa: BLE001
        return None
