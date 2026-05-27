"""JPEG frame fan-out.

The LCM pump thread feeds the latest JPEG-encoded frame (from
`/color_image` published via `_with_jpeglcm` on the robot/sim side) into
this hub. HTTP MJPEG clients each get their own bounded queue so a slow
viewer can't back-pressure the others — we just drop the previous frame
when a new one arrives.

The dimos blueprint never starts its own HTTP video server, so the
bridge takes that role here. This keeps the spec's plane boundary intact
— only ov-bridge ever speaks LCM.
"""
from __future__ import annotations

import asyncio
from typing import Optional


class FrameHub:
    def __init__(self) -> None:
        self.latest: Optional[bytes] = None
        self._subscribers: set[asyncio.Queue[Optional[bytes]]] = set()

    async def subscribe(self) -> asyncio.Queue[Optional[bytes]]:
        q: asyncio.Queue[Optional[bytes]] = asyncio.Queue(maxsize=1)
        self._subscribers.add(q)
        # Prime new viewers with the most recent frame so the <img> doesn't
        # sit blank for up to 1/(camera_fps) seconds.
        if self.latest is not None:
            try:
                q.put_nowait(self.latest)
            except asyncio.QueueFull:
                pass
        return q

    async def unsubscribe(self, q: asyncio.Queue[Optional[bytes]]) -> None:
        self._subscribers.discard(q)
        # Wake any awaiter so the generator can exit promptly.
        try:
            q.put_nowait(None)
        except asyncio.QueueFull:
            pass

    def publish_threadsafe(
        self, jpeg: bytes, loop: asyncio.AbstractEventLoop
    ) -> None:
        """Called from the LCM pump thread."""
        loop.call_soon_threadsafe(self._publish, jpeg)

    def _publish(self, jpeg: bytes) -> None:
        self.latest = jpeg
        for q in list(self._subscribers):
            if q.full():
                # Drop the stale frame so we always serve the newest one.
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                q.put_nowait(jpeg)
            except asyncio.QueueFull:
                pass

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)
