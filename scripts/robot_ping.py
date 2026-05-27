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

The final step sends a `Hello` sport command — the dog should wave a
paw if it's working. That's your "yes this is really connected"
confirmation. No dashboard required.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time


GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
DIM = "\033[2m"
RESET = "\033[0m"


def ok(msg: str) -> None:
    print(f"{GREEN}✓{RESET} {msg}")


def fail(msg: str, hint: str = "") -> None:
    print(f"{RED}✗{RESET} {msg}")
    if hint:
        print(f"  {DIM}{hint}{RESET}")
    sys.exit(1)


def step(msg: str) -> None:
    print(f"{YELLOW}→{RESET} {msg}")


def load_dotenv_if_any() -> None:
    """Best-effort `.env` import so the script picks up ROBOT_IP without
    needing the operator to export it."""
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(here)
    dotenv = os.path.join(repo_root, ".env")
    if not os.path.exists(dotenv):
        return
    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv(dotenv)
    except Exception:
        # Manual fallback — just key=value lines, no shell expansion.
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
            "(default password 00000000) and retry.",
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


def webrtc_connect(ip: str):
    step("opening WebRTC connection via dimos (this takes ~5-15s)…")
    try:
        from dimos.robot.unitree.connection import UnitreeWebRTCConnection
    except ImportError as e:
        fail(
            f"dimos not importable: {e}",
            "run `source .venv/bin/activate && make setup` first.",
        )
    conn = UnitreeWebRTCConnection(ip)
    try:
        conn.connect()
    except Exception as e:
        fail(
            f"connect raised: {e}",
            "if this just says 'data channel not open', try killing any "
            "other process holding a session: `pkill -9 -f overwatch_patrol`, "
            "wait 30s for the dog to clean up, retry. Power-cycling the dog "
            "is the nuclear option that always works.",
        )
    ok("WebRTC peer connection established")
    return conn


def send_hello(conn) -> None:
    """Tells the dog to wave its paw — visible confirmation the data
    channel is actually moving bytes both ways.
    """
    step("waiting 3s for data channel to settle…")
    time.sleep(3)
    step("sending Hello sport command (dog should wave a paw)")
    try:
        from dimos.robot.unitree.unitree_skill_container import _UNITREE_COMMANDS
        from unitree_webrtc_connect.constants import RTC_TOPIC

        cmd_id = _UNITREE_COMMANDS["Hello"][0]
        result = conn.publish_request(
            RTC_TOPIC["SPORT_MOD"], {"api_id": cmd_id},
        )
    except Exception as e:
        fail(
            f"sport command threw: {e}",
            "data channel went down between connect and command. The 4G "
            "relay path is flaky; if you're on cellular, try power-cycling.",
        )
    if not result:
        fail(
            "sport command returned False",
            "the dog received the request but rejected it. Most likely the "
            "dog is in a state where sport commands are disabled (damped, "
            "locked, lying on its side).",
        )
    ok(f"sport command ack'd: result={result}")


def main() -> None:
    ip = resolve_ip()
    print()
    print(f"  robot_ping → {ip}")
    print()
    ping(ip)
    signaling_check(ip)
    conn = webrtc_connect(ip)
    send_hello(conn)
    print()
    print(f"{GREEN}==========================================={RESET}")
    print(f"{GREEN}  ✓ all good — your dog is reachable.{RESET}")
    print(f"{GREEN}    Did you see it wave a paw?{RESET}")
    print(f"{GREEN}==========================================={RESET}")
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\ninterrupted")
        sys.exit(130)
