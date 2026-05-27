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

Diagnostic logging: we mirror everything from the `overwatch_patrol`
loggers to `/tmp/overwatch_surveillance.log` so an operator can `tail -f`
without having to find the dimos worker's stderr (which on `make robot`
runs behind a forkserver and is easy to miss).
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from typing import Any, Optional

import structlog

from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig

from .clip_recorder_core import ClipRecorderConfig, ClipRecorderCore

log = structlog.get_logger()


_FILE_LOG_PATH = "/tmp/overwatch_surveillance.log"
_file_log_configured = False


def _setup_file_log() -> None:
    """Mirror everything from this module's stdlib logger to a known file.

    Same shape as `surveillance_module._setup_file_log` — both modules
    write to the same log so an operator can `tail -f` one file.
    """
    global _file_log_configured
    if _file_log_configured:
        return
    try:
        handler = logging.FileHandler(_FILE_LOG_PATH, mode="a")
        handler.setFormatter(
            logging.Formatter("%(asctime)s [%(name)s] %(message)s"),
        )
        root = logging.getLogger()
        # Only add the handler once across the process even if multiple
        # modules call _setup_file_log; the surveillance module checks
        # the same flag.
        for h in root.handlers:
            if isinstance(h, logging.FileHandler) and getattr(h, "baseFilename", "") == _FILE_LOG_PATH:
                _file_log_configured = True
                return
        root.addHandler(handler)
        if root.level > logging.INFO:
            root.setLevel(logging.INFO)
        _file_log_configured = True
    except Exception as e:  # noqa: BLE001
        log.warning("clip_recorder.file_log_setup_failed", error=str(e))


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
        self._threads_started = False
        _setup_file_log()
        log.info(
            "clip_recorder.module_init_done",
            output_dir=output_dir,
            fps=self.config.fps,
            ffmpeg=shutil.which("ffmpeg") or "<not on PATH>",
        )

    @rpc
    def start(self) -> None:
        super().start()
        # Defer thread starts until dimos has handed the module a worker
        # and run super().start(). Spinning the LCM listeners up in
        # __init__ can race with module-coordinator lifecycle on cold
        # boots; doing it here is the canonical dimos pattern.
        if not self._threads_started:
            self._start_threads()
            self._threads_started = True
        log.info(
            "clip_recorder.module_started",
            output_dir=self.core.config.output_dir,
        )

    @rpc
    def stop(self) -> None:
        log.info("clip_recorder.module_stopped")
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
            log.info(
                "clip_recorder.published",
                topic=topic,
                type=payload.get("type"),
                incident_id=payload.get("incident_id"),
            )
        except Exception as e:  # noqa: BLE001
            log.error("clip_recorder.publish_fail", topic=topic, error=str(e))

    # ------------------------------------------------------------------
    # LCM ingestion + periodic close + finalize.
    # ------------------------------------------------------------------

    def _start_threads(self) -> None:
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
        log.info("clip_recorder.threads_started")

    def _run_image_listener(self) -> None:
        try:
            import lcm  # type: ignore
            import numpy as np  # type: ignore
            import cv2  # type: ignore
            from dimos_lcm.sensor_msgs.Image import Image as LCMImage  # type: ignore
        except Exception as e:  # noqa: BLE001
            log.error("clip_recorder.image_imports_failed", error=str(e))
            return

        w, h = self.core.config.width, self.core.config.height
        log.info("clip_recorder.image_listener_alive", width=w, height=h)
        # Frame-flow heartbeat: log a count every ~5s so the operator can
        # see whether /color_image is reaching us at all. The surveillance
        # detector has a similar pattern.
        stats = {"count": 0, "last_log": time.monotonic()}

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
                stats["count"] += 1
                now = time.monotonic()
                if now - stats["last_log"] >= 5.0:
                    log.info(
                        "clip_recorder.frame_heartbeat",
                        frames_in_window=stats["count"],
                        active_clips=len(self.core._active),  # noqa: SLF001
                    )
                    stats["count"] = 0
                    stats["last_log"] = now
            except Exception as e:  # noqa: BLE001
                log.warning("clip_recorder.frame_handle_fail", error=str(e))

        lc = lcm.LCM(
            os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
        )
        lc.subscribe(r"^/color_image(#.*)?$", _handler)
        log.info(
            "clip_recorder.image_lcm_subscribed",
            url=os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
        )
        # Initial waiting log so a silent stream is visible early.
        wait_ticks = 0
        while True:
            try:
                lc.handle_timeout(200)
                if stats["count"] == 0:
                    wait_ticks += 1
                    if wait_ticks in (25, 250):  # ~5s, ~50s of no frames
                        log.warning(
                            "clip_recorder.waiting_for_frames",
                            ticks=wait_ticks,
                        )
                else:
                    wait_ticks = 0
            except Exception as e:  # noqa: BLE001
                log.error("clip_recorder.image_pump_error", error=str(e))
                return

    def _run_event_listener(self) -> None:
        try:
            import lcm  # type: ignore
            from dimos_lcm.std_msgs.String import String  # type: ignore
        except Exception as e:  # noqa: BLE001
            log.error("clip_recorder.event_imports_failed", error=str(e))
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
                            log.info(
                                "clip_recorder.incident_opened_received",
                                incident_id=iid,
                                buffered_frames=len(self.core._frames),  # noqa: SLF001
                            )
                            self.core.on_incident_opened(iid)
                    elif topic == "/ow/incident_closed":
                        iid = payload.get("incident_id")
                        if iid:
                            log.info(
                                "clip_recorder.incident_closed_received",
                                incident_id=iid,
                            )
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
        log.info(
            "clip_recorder.event_lcm_subscribed",
            topics=["/ow/detections", "/ow/incident_opened", "/ow/incident_closed"],
        )
        while True:
            try:
                lc.handle_timeout(200)
            except Exception as e:  # noqa: BLE001
                log.error("clip_recorder.event_pump_error", error=str(e))
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
