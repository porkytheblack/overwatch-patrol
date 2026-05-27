"""Fan-out WS server: every received LCM event becomes a JSON message."""
from __future__ import annotations

import asyncio
import json
from typing import Any

from aiohttp import WSMsgType, web
import structlog

log = structlog.get_logger()


class WsHub:
    def __init__(self) -> None:
        self._clients: set[web.WebSocketResponse] = set()
        self._lock = asyncio.Lock()

    async def add(self, ws: web.WebSocketResponse) -> None:
        async with self._lock:
            self._clients.add(ws)
        log.info("ws.connect", clients=len(self._clients))

    async def remove(self, ws: web.WebSocketResponse) -> None:
        async with self._lock:
            self._clients.discard(ws)
        log.info("ws.disconnect", clients=len(self._clients))

    async def broadcast(self, event: dict[str, Any]) -> None:
        msg = json.dumps(event, separators=(",", ":"))
        async with self._lock:
            dead = []
            for c in self._clients:
                try:
                    await c.send_str(msg)
                except Exception:
                    dead.append(c)
            for c in dead:
                self._clients.discard(c)


async def ws_handler(req: web.Request) -> web.WebSocketResponse:
    hub: WsHub = req.app["hub"]
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(req)
    await hub.add(ws)
    try:
        async for msg in ws:
            if msg.type == WSMsgType.ERROR:
                break
    finally:
        await hub.remove(ws)
    return ws


async def health_handler(_req: web.Request) -> web.Response:
    return web.json_response({"status": "ok"})


async def mjpeg_handler(req: web.Request) -> web.StreamResponse:
    """Multipart MJPEG stream of the latest LCM /color_image frames.

    Each consumer gets its own bounded queue from the FrameHub so a slow
    client only stalls itself. The response stays open until the client
    disconnects (StreamResponse.write raises) or the hub feeds a None
    sentinel during shutdown.
    """
    hub = req.app.get("frames")
    if hub is None:
        return web.json_response({"error": "frames_disabled"}, status=503)

    boundary = "frame"
    resp = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": f"multipart/x-mixed-replace; boundary={boundary}",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
        },
    )
    await resp.prepare(req)
    q = await hub.subscribe()
    try:
        while True:
            jpeg = await q.get()
            if jpeg is None:
                break
            chunk = (
                f"--{boundary}\r\n"
                f"Content-Type: image/jpeg\r\n"
                f"Content-Length: {len(jpeg)}\r\n\r\n"
            ).encode("ascii") + jpeg + b"\r\n"
            await resp.write(chunk)
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    except Exception as e:  # noqa: BLE001
        log.warning("mjpeg.stream_error", error=str(e))
    finally:
        await hub.unsubscribe(q)
    return resp


async def waypoint_sync_handler(req: web.Request) -> web.Response:
    """Internal RPC: called by `SurveillanceModule.add_waypoint` /
    `delete_waypoint` to upsert/delete a row. Mirrors the body of an LCM
    `/ow/waypoint_sync` event but reaches us via HTTP for environments
    where the robot host can't multicast directly to the bridge container.
    """
    try:
        payload = await req.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    required = ("waypoint_id", "name", "pose", "action")
    if not all(k in payload for k in required):
        return web.json_response({"error": "missing_fields"}, status=400)
    storage = req.app["storage"]
    try:
        storage.upsert_waypoint(payload)
    except Exception as e:  # noqa: BLE001
        log.exception("waypoint_sync.error", error=str(e))
        return web.json_response({"error": "storage_error"}, status=500)
    hub: WsHub = req.app["hub"]
    await hub.broadcast({"type": "waypoint.sync", **payload})
    return web.json_response({"ok": True})


def make_app(hub: WsHub, storage=None, frames=None) -> web.Application:
    app = web.Application()
    app["hub"] = hub
    if storage is not None:
        app["storage"] = storage
    if frames is not None:
        app["frames"] = frames
    app.router.add_get("/events", ws_handler)
    app.router.add_get("/health", health_handler)
    app.router.add_post("/sync/waypoint", waypoint_sync_handler)
    app.router.add_get("/video_feed/color_image", mjpeg_handler)
    return app
