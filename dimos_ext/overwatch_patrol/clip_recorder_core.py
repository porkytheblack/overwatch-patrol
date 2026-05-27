"""Pure clip-recorder logic — extracted so it's unit-testable without dimos.
The dimos `ClipRecorderModule` in `clip_recorder.py` wraps this. Ring
buffer + MP4 writer with bbox overlays (spec §7.3).
"""
from __future__ import annotations

import os
import subprocess
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


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
class ClipRecorderCore:
    config: ClipRecorderConfig = field(default_factory=ClipRecorderConfig)
    _frames: deque = field(init=False)
    _detections: deque = field(init=False)
    _active: dict[str, "ActiveClip"] = field(default_factory=dict)

    publish_lcm: callable = lambda _topic, _payload: None  # type: ignore

    def __post_init__(self) -> None:
        # Sized to hold `pre_roll_s` seconds at the configured fps, plus a
        # small headroom for clock jitter.
        cap = max(int(self.config.pre_roll_s * self.config.fps * 1.2), 30)
        self._frames = deque(maxlen=cap)
        self._detections = deque(maxlen=cap)

    def on_frame(self, ts: float, image_bgr: bytes) -> None:
        self._frames.append(_Frame(ts, image_bgr))
        # Find the nearest detection batch by timestamp for the overlay.
        nearest = self._nearest_detections(ts)
        for clip in self._active.values():
            clip.push_frame(ts, image_bgr, nearest)

    def on_detections(self, ts: float, detections: list[dict]) -> None:
        self._detections.append((ts, detections))

    def _nearest_detections(self, ts: float) -> list[dict]:
        if not self._detections:
            return []
        best_dt = float("inf")
        best: list[dict] = []
        for dts, dets in self._detections:
            dt = abs(dts - ts)
            if dt < best_dt:
                best_dt = dt
                best = dets
        return best

    def on_incident_opened(self, incident_id: str) -> None:
        Path(self.config.output_dir).mkdir(parents=True, exist_ok=True)
        out_mp4 = os.path.join(self.config.output_dir, f"{incident_id}.mp4")
        clip = ActiveClip(
            incident_id=incident_id,
            path=out_mp4,
            config=self.config,
        )
        # Push pre-roll, with overlay derived from the nearest detection batch.
        for f in self._frames:
            clip.push_frame(f.ts, f.image, self._nearest_detections(f.ts))
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
    duration_ms: float = 0.0
    frame_count: int = 0
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

    def push_frame(self, ts: float, image_bgr: bytes, detections: list[dict]) -> None:
        if self._proc is None:
            self._start_ffmpeg()
            self._started_at = ts
        composited = _composite_bboxes(
            image_bgr, detections, self.config.width, self.config.height
        )
        if self._proc and self._proc.stdin:
            try:
                self._proc.stdin.write(composited)
            except BrokenPipeError:
                pass
        self._last_ts = ts
        self.frame_count += 1

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
        # Poster: middle frame of the actual clip duration.
        if self.frame_count > 0:
            middle = max(0, self.frame_count // 2)
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
                        f"select=eq(n\\,{middle})",
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


def _composite_bboxes(
    image_bgr: bytes,
    detections: list[dict],
    width: int,
    height: int,
) -> bytes:
    """Overlay `cv2.rectangle` + class·conf label per detection.

    Returns the composited bgr24 bytes. If OpenCV/NumPy aren't available
    (CI / unit tests), or there are no detections to draw, returns the
    input unchanged.
    """
    if not detections:
        return image_bgr
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except Exception:  # pragma: no cover - CI fallback
        return image_bgr

    try:
        arr = np.frombuffer(image_bgr, dtype=np.uint8).reshape((height, width, 3)).copy()
    except Exception:
        return image_bgr

    amber = (11, 158, 245)  # BGR for the brand accent #F59E0B
    for det in detections:
        bbox = det.get("bbox") or {}
        try:
            x = int(bbox["x"])
            y = int(bbox["y"])
            w = int(bbox["w"])
            h = int(bbox["h"])
        except (KeyError, TypeError, ValueError):
            continue
        cv2.rectangle(arr, (x, y), (x + w, y + h), amber, 1)
        label = f"{det.get('class', '?')}·{int((det.get('confidence', 0)) * 100)}%"
        cv2.putText(
            arr,
            label,
            (x, max(0, y - 4)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            amber,
            1,
            cv2.LINE_AA,
        )
    return arr.tobytes()
