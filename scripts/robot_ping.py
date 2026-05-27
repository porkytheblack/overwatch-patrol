#!/usr/bin/env python3
"""robot_ping — minimal "is my Go2 reachable" smoke test.

Tries each layer of the connection in turn and reports a clear ✓/✗ at
every step:

  1. ICMP ping        → is the dog on the network at all?
  2. TCP probe :9991  → is the dog's WebRTC signaling service up?
  3. WebRTC handshake → can dimos open a peer connection + data channel?
  4. Sport command    → does the dog physically respond?

Run it like this:

    .venv/bin/python scripts/robot_ping.py            # uses ROBOT_IP from .env
    .venv/bin/python scripts/robot_ping.py 192.168.12.1   # explicit ip

The final step sends `StandUp` (sport id 1004) followed by `Hello` (id
1016) — the dog should stand if sitting, then wave a paw. That's your
"yes this is really connected" confirmation. No dashboard required.
"""
from __future__ import annotations

import io
import logging
import os
import subprocess
import sys
import time
from contextlib import redirect_stderr, redirect_stdout


GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"


def ok(msg: str) -> None:
    print(f"{GREEN}✓{RESET} {msg}", flush=True)


def fail(msg: str, hint: str = "") -> None:
    print(f"{RED}✗{RESET} {msg}", flush=True)
    if hint:
        print(f"  {DIM}{hint}{RESET}", flush=True)
    sys.exit(1)


def step(msg: str) -> None:
    print(f"{YELLOW}→{RESET} {msg}", flush=True)


def load_dotenv_if_any() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(here)
    dotenv = os.path.join(repo_root, ".env")
    if not os.path.exists(dotenv):
        return
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(dotenv)
        return
    except Exception:
        pass
    with open(dotenv) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def resolve_ip() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1]
    load_dotenv_if_any()
    ip = os.environ.get("ROBOT_IP")
    if not ip:
        fail(
            "no ROBOT_IP",
            "usage: robot_ping.py <ip>   (or set ROBOT_IP in .env)",
        )
    return ip


def ping(ip: str) -> None:
    step(f"ping {ip}")
    r = subprocess.run(
        ["ping", "-c", "2", "-W", "1000", ip],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        fail(
            "no ICMP response",
            "you're not on the dog's network. Join the Unitree_GoXXXXXX wifi "
            "and retry.",
        )
    ok("ping ok")


def tcp_probe(ip: str, port: int) -> bool:
    r = subprocess.run(
        ["nc", "-zv", "-w", "2", ip, str(port)],
        capture_output=True,
        text=True,
    )
    return r.returncode == 0


def signaling_check(ip: str) -> None:
    step(f"checking WebRTC signaling on {ip}:8081 and {ip}:9991")
    old_method = tcp_probe(ip, 8081)
    new_method = tcp_probe(ip, 9991)
    if not (old_method or new_method):
        fail(
            "both signaling ports refused (8081 + 9991)",
            "the dog's AI services aren't running. Hold L2+B on the controller "
            "to switch to AI mode, wait 30s, then retry.",
        )
    if new_method:
        ok("port 9991 open (new method)")
    if old_method:
        ok("port 8081 open (old method)")


def silence_dimos() -> None:
    """Quiet the root logger and aiortc/aioice so dimos's verbose
    connection output doesn't drown out our progress messages.

    Errors from this script still print via our own `fail()` / `ok()`.
    """
    logging.getLogger().setLevel(logging.CRITICAL)
    for noisy in (
        "aiortc",
        "aioice",
        "asyncio",
        "dimos",
        "unitree_webrtc_connect",
        "root",
    ):
        logging.getLogger(noisy).setLevel(logging.CRITICAL)


def webrtc_connect(ip: str):
    step("opening WebRTC connection (this takes ~5-15s, dimos logs suppressed)…")
    silence_dimos()

    # Capture stdout/stderr during the connect so dimos's print() output
    # (the 🕒 status lines, the 8081 ConnectionRefused, etc.) doesn't
    # mix into our clean progress trail.
    captured = io.StringIO()

    try:
        from dimos.robot.unitree.connection import UnitreeWebRTCConnection
    except ImportError as e:
        fail(
            f"dimos not importable: {e}",
            "run `source .venv/bin/activate && make setup` first.",
        )

    try:
        # The constructor itself calls connect() — DO NOT call connect()
        # again or you'll trigger a duplicate handshake which fails
        # because the dog only accepts one client at a time.
        with redirect_stdout(captured), redirect_stderr(captured):
            conn = UnitreeWebRTCConnection(ip)
    except Exception as e:
        print(captured.getvalue(), file=sys.stderr)
        fail(
            f"WebRTC connect raised: {e}",
            "if you see 'data channel not open', kill any other process "
            "holding a session: `pkill -9 -f overwatch_patrol`, wait 30s "
            "for the dog to clean up. Power-cycling the dog also works.",
        )

    # Verify the data channel is actually open before claiming success.
    if not getattr(conn, "connection_ready", None) or not conn.connection_ready.is_set():
        print(captured.getvalue(), file=sys.stderr)
        fail("WebRTC handshake completed but data channel didn't signal ready")

    ok("WebRTC peer connection + data channel up")
    return conn, captured


def send_command(conn, cmd_name: str, cmd_id: int) -> None:
    step(f"sending {cmd_name} (sport id={cmd_id})")
    try:
        from unitree_webrtc_connect.constants import RTC_TOPIC

        result = conn.publish_request(
            RTC_TOPIC["SPORT_MOD"], {"api_id": cmd_id},
        )
    except Exception as e:
        fail(
            f"{cmd_name} threw: {e}",
            "the data channel was open but the request didn't land. "
            "Power-cycle the dog and retry.",
        )
    if not result:
        fail(
            f"{cmd_name} returned False",
            "dog received the request but rejected it. Most likely it's "
            "damped / on its side. Stand it up manually then retry.",
        )
    ok(f"{cmd_name} ack'd")


def main() -> None:
    ip = resolve_ip()
    print()
    print(f"  {BOLD}robot_ping → {ip}{RESET}")
    print()

    ping(ip)
    signaling_check(ip)
    conn, captured = webrtc_connect(ip)

    # Two physical commands. StandUp brings the dog up if sitting and
    # is a safe no-op otherwise. Hello is the unambiguous visible test
    # — the dog waves a paw if it can.
    time.sleep(2)  # let the data channel settle past the auth handshake
    send_command(conn, "StandUp", 1004)
    time.sleep(2)
    send_command(conn, "Hello", 1016)

    print()
    print(f"{GREEN}{BOLD}==========================================={RESET}")
    print(f"{GREEN}{BOLD}  ✓ all good — your dog is reachable.{RESET}")
    print(f"{GREEN}{BOLD}    Did you see it stand and wave?{RESET}")
    print(f"{GREEN}{BOLD}==========================================={RESET}")
    print()

    # Show the suppressed dimos output at the very end for debugging
    # if anything seemed off but the script claimed success.
    if os.environ.get("ROBOT_PING_VERBOSE"):
        print(f"{DIM}--- dimos output (suppressed) ---{RESET}")
        print(captured.getvalue())


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\ninterrupted")
        sys.exit(130)
