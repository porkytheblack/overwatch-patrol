import os
import sys
from dataclasses import dataclass
from pathlib import Path

# Try to load .env from the repo root for host-mode runs. In Docker compose
# the env comes from the `environment:` section and python-dotenv is not
# required — we wrap the import so a missing dep doesn't crash the bridge.
try:
    from dotenv import load_dotenv  # type: ignore

    _REPO_ROOT = Path(__file__).resolve().parents[3]
    _DOTENV = _REPO_ROOT / ".env"
    if _DOTENV.exists():
        load_dotenv(_DOTENV)
except Exception:
    _REPO_ROOT = Path(__file__).resolve().parents[3]


def _resolve_data_path(raw: str, fallback_name: str) -> str:
    """Mirror the TS env.ts logic: if `/data/...` isn't writable on the host,
    fall back to `<repoRoot>/data/<basename>`. Relative paths resolve against
    the repo root.
    """
    if not raw:
        return str(_REPO_ROOT / "data" / fallback_name)
    p = Path(raw)
    is_in_data = raw.startswith("/data/") or raw == "/data"
    if is_in_data and not _can_write("/data"):
        remapped = _REPO_ROOT / "data" / p.name
        sys.stderr.write(
            f"[bridge] SQLITE_PATH {raw!r} not writable on this host; "
            f"using {str(remapped)!r} instead.\n"
        )
        return str(remapped)
    if not p.is_absolute():
        return str(_REPO_ROOT / raw)
    return raw


def _can_write(path: str) -> bool:
    try:
        return os.access(path, os.W_OK)
    except Exception:
        return False


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
            sqlite_path=_resolve_data_path(
                os.environ.get("SQLITE_PATH", ""),
                "overwatch.db",
            ),
            ws_port=int(os.environ.get("WS_PORT", "7001")),
            log_level=os.environ.get("LOG_LEVEL", "info").upper(),
        )
