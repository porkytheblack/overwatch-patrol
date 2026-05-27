"""ClipRecorderModule — dimos `Module` wrapper around `ClipRecorderCore`.

Subscribes to `/color_image` (rolling deque of last `pre_roll_s` seconds)
and `/ow/detections` (parallel deque indexed by ts). On `incident.opened`,
spawns an ffmpeg subprocess writing `data/clips/{incident_id}.mp4`; on
`incident.closed`, continues for `post_roll_s` seconds and closes. Extracts
a poster JPEG from the middle frame and publishes `/ow/clip_ready`.

The pure logic lives in `clip_recorder_core.ClipRecorderCore` (unit-testable);
this file is the dimos-coupled adapter.
"""
from __future__ import annotations

from typing import Any

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
        self.core = ClipRecorderCore(
            config=ClipRecorderConfig(
                output_dir=self.config.output_dir,
                pre_roll_s=self.config.pre_roll_s,
                post_roll_s=self.config.post_roll_s,
                fps=self.config.fps,
                width=self.config.width,
                height=self.config.height,
            ),
        )

    @rpc
    def start(self) -> None:
        super().start()
        log.info("clip_recorder.module.started")

    @rpc
    def stop(self) -> None:
        log.info("clip_recorder.module.stopped")
        super().stop()
