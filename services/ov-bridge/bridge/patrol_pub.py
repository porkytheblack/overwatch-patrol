"""Outbound patrol-command publisher.

Publishes `{"type":"patrol_command","action":"start|stop|pause|resume"}`
on the LCM channel `/ow/patrol_command` as `std_msgs.String` JSON.
SurveillanceModule subscribes and flips the state machine directly —
bypassing MCP's RPC backplane that hangs at 120s on the cellular
relay path. Mirrors the sport-command bypass exactly.
"""
from __future__ import annotations

import json
import os
from typing import Optional

import structlog

log = structlog.get_logger()

PATROL_TOPIC = "/ow/patrol_command"
VALID_ACTIONS = ("start", "stop", "pause", "resume")


class PatrolPublisher:
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
            log.warning("patrol.lcm_unavailable", error=str(e))
            return False
        self._lc = lcm.LCM(self._lcm_url)
        self._String = String
        return True

    def publish_action(self, action: str) -> bool:
        if action not in VALID_ACTIONS:
            log.warning("patrol.invalid_action", action=action)
            return False
        if not self._lazy_init():
            return False
        payload = {"type": "patrol_command", "action": action}
        msg = self._String(data=json.dumps(payload, separators=(",", ":")))  # type: ignore[misc]
        self._lc.publish(PATROL_TOPIC, msg.lcm_encode())  # type: ignore[union-attr]
        log.info("patrol.published", action=action)
        return True
