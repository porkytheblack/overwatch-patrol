import os
import sys
from dataclasses import dataclass
from pathlib import Path


def _find_repo_root() -> Path:
    """Walk up from this file looking for a marker that says "repo root".

    On the host the layout is `<repo>/services/ov-bridge/bridge/config.py`
    so the repo root is `parents[3]`. Inside Docker the bridge is copied
    to `/app/bridge/config.py` and there is no parents[3] — we just return
    the working directory.
    """
    here = Path(__file__).resolve()
    for parent in (*here.parents, Path.cwd()):
        # Markers that uniquely identify the repo root.
        if (parent / "pnpm-workspace.yaml").exists() or (parent / ".env").exists():
            return parent
    return Path.cwd()


_REPO_ROOT = _find_repo_root()

# Best-effort .env load (host-mode only; in Docker the env is injected via
# compose's `environment:` block and python-dotenv is silent if .env absent).
try:
    from dotenv import load_dotenv  # type: ignore

    _DOTENV = _REPO_ROOT / ".env"
    if _DOTENV.exists():
        load_dotenv(_DOTENV)
except Exception:
    pass


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
