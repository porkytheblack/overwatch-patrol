import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    lcm_url: str
    sqlite_path: str
    ws_port: int
    log_level: str

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            lcm_url=os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
            sqlite_path=os.environ.get("SQLITE_PATH", "/data/overwatch.db"),
            ws_port=int(os.environ.get("WS_PORT", "7001")),
            log_level=os.environ.get("LOG_LEVEL", "info").upper(),
        )
