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


def make_app(hub: WsHub) -> web.Application:
    app = web.Application()
    app["hub"] = hub
    app.router.add_get("/events", ws_handler)
    app.router.add_get("/health", health_handler)
    return app
