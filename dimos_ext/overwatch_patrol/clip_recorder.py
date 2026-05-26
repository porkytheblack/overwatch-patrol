"""ClipRecorderModule — ring buffer + MP4 writer with bbox overlays.

Subscribes to `/color_image` (rolling deque of the last `pre_roll_s` seconds)
and `/ow/detections` (parallel deque of detection lists indexed by ts).
On `IncidentOpened`, spawns an ffmpeg subprocess writing
`data/clips/{incident_id}.mp4`; on `IncidentClosed`, continues for
`post_roll_s` seconds and closes. Extracts a poster JPEG from the middle
frame. Publishes `/ow/clip_ready`.

This module is import-safe without dimos; runtime instantiation expects
OpenCV + ffmpeg-python which are listed in `dimos_ext/pyproject.toml`.
"""
from __future__ import annotations

import os
import subprocess
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class ClipRecorderConfig:
    output_dir: str = "/data/clips"
    pre_roll_s: float = 5.0
    post_roll_s: float = 10.0
    fps: int = 15
    width: int = 1280
    height: int = 720


@dataclass
class _Frame:
    ts: float
    image: bytes  # raw bgr24


@dataclass
class ClipRecorderModule:
    config: ClipRecorderConfig = field(default_factory=ClipRecorderConfig)
    _frames: deque = field(default_factory=lambda: deque(maxlen=300))
    _detections: deque = field(default_factory=lambda: deque(maxlen=300))
    _active: dict[str, "ActiveClip"] = field(default_factory=dict)

    publish_lcm: callable = lambda _topic, _payload: None  # type: ignore

    def on_frame(self, ts: float, image_bgr: bytes) -> None:
        self._frames.append(_Frame(ts, image_bgr))
        for clip in self._active.values():
            clip.push_frame(ts, image_bgr)

    def on_detections(self, ts: float, detections: list[dict]) -> None:
        self._detections.append((ts, detections))

    def on_incident_opened(self, incident_id: str) -> None:
        Path(self.config.output_dir).mkdir(parents=True, exist_ok=True)
        out_mp4 = os.path.join(self.config.output_dir, f"{incident_id}.mp4")
        clip = ActiveClip(
            incident_id=incident_id,
            path=out_mp4,
            config=self.config,
        )
        # Push pre-roll
        for f in self._frames:
            clip.push_frame(f.ts, f.image)
        self._active[incident_id] = clip

    def on_incident_closed(self, incident_id: str) -> None:
        clip = self._active.get(incident_id)
        if not clip:
            return
        clip.schedule_close(self.config.post_roll_s)

    def tick(self, now: float) -> None:
        finished: list[str] = []
        for iid, clip in self._active.items():
            if clip.is_finished(now):
                clip.finalize()
                self.publish_lcm(
                    "/ow/clip_ready",
                    {
                        "type": "clip.ready",
                        "incident_id": iid,
                        "clip_path": clip.path,
                        "poster_path": clip.poster_path,
                        "duration_ms": clip.duration_ms,
                    },
                )
                finished.append(iid)
        for iid in finished:
            del self._active[iid]


@dataclass
class ActiveClip:
    incident_id: str
    path: str
    config: ClipRecorderConfig
    poster_path: str = ""
    duration_ms: float = 0
    _proc: Optional[subprocess.Popen] = None
    _started_at: Optional[float] = None
    _close_at: Optional[float] = None
    _last_ts: float = 0.0

    def __post_init__(self) -> None:
        self.poster_path = self.path[:-4] + ".jpg"

    def _start_ffmpeg(self) -> None:
        self._proc = subprocess.Popen(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "bgr24",
                "-s",
                f"{self.config.width}x{self.config.height}",
                "-r",
                str(self.config.fps),
                "-i",
                "-",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                self.path,
            ],
            stdin=subprocess.PIPE,
        )

    def push_frame(self, ts: float, image_bgr: bytes) -> None:
        if self._proc is None:
            self._start_ffmpeg()
            self._started_at = ts
        if self._proc and self._proc.stdin:
            try:
                self._proc.stdin.write(image_bgr)
            except BrokenPipeError:
                pass
        self._last_ts = ts

    def schedule_close(self, post_roll_s: float) -> None:
        self._close_at = self._last_ts + post_roll_s

    def is_finished(self, now: float) -> bool:
        return self._close_at is not None and now >= self._close_at

    def finalize(self) -> None:
        if self._proc and self._proc.stdin:
            try:
                self._proc.stdin.close()
            except Exception:
                pass
            self._proc.wait()
        # Poster: dump the middle frame via ffmpeg
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-loglevel",
                    "error",
                    "-i",
                    self.path,
                    "-vf",
                    "select=eq(n\\,30)",
                    "-vframes",
                    "1",
                    self.poster_path,
                ],
                check=False,
            )
        except Exception:
            pass
        if self._started_at:
            self.duration_ms = (self._last_ts - self._started_at) * 1000
