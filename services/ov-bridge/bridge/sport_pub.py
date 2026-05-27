"""Outbound sport-command publisher.

Publishes `{"type":"sport_request","command":"Hello"}` (or whatever
command) on the LCM channel `/ow/sport_request` as a `std_msgs.String`
JSON message. SurveillanceModule subscribes to that topic and calls
`self._connection.publish_request(SPORT_MOD, ...)` directly — bypassing
MCP's RPC backplane that hangs at 120s on the 4G relay path.

The bridge holds the LCM publisher because dashboard / api are
TypeScript and can't speak LCM directly, but the bridge already does
for the bidirectional /ow/* event flow.
"""
from __future__ import annotations

import json
import os
from typing import Optional

import structlog

log = structlog.get_logger()

SPORT_TOPIC = "/ow/sport_request"


class SportPublisher:
    def __init__(self, lcm_url: Optional[str] = None) -> None:
        self._lcm_url = lcm_url or os.environ.get(
            "LCM_URL", "udpm://239.255.76.67:7667?ttl=1",
        )
        self._lc = None
        self._String = None

    def _lazy_init(self) -> bool:
        if self._lc is not None and self._String is not None:
            return True
        try:
            import lcm  # type: ignore
            from dimos_lcm.std_msgs.String import String  # type: ignore
        except Exception as e:  # noqa: BLE001
            log.warning("sport.lcm_unavailable", error=str(e))
            return False
        self._lc = lcm.LCM(self._lcm_url)
        self._String = String
        return True

    def publish_sport(self, command: str) -> bool:
        if not self._lazy_init():
            return False
        payload = {"type": "sport_request", "command": str(command)}
        msg = self._String(data=json.dumps(payload, separators=(",", ":")))  # type: ignore[misc]
        self._lc.publish(SPORT_TOPIC, msg.lcm_encode())  # type: ignore[union-attr]
        log.info("sport.published", command=command)
        return True
