"""
Launcher for the LME Bloomberg bridge, used by start-prod.bat / start-uat.bat.

Picks a free local port *before* starting the server (and so before any
Bloomberg session is opened), so a port already taken by another program gives
a plain-English message instead of a raw "WinError 10048" traceback:

- Port free                             -> start the bridge there.
- Port held by this bridge (same env)   -> it's already running; just open the page.
- Port held by anything else            -> try the next port.

Once the server answers, the browser is opened at http://localhost:<port>/,
which the bridge serves itself, so the page always talks to the right port.

Run from the project root:  python -m backend.launch
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

from dotenv import load_dotenv

# Must match the "app" field returned by /api/health in main.py
APP_ID = "lme-order-entry"
# How many ports past APP_PORT to try before giving up
PORT_RANGE = 10

LME_ENV = os.getenv("LME_ENV", "UAT").upper()
load_dotenv(Path(__file__).parent.parent / f".env.{LME_ENV.lower()}")
BASE_PORT = int(os.getenv("APP_PORT", "8000"))
START_SCRIPT = f"start-{LME_ENV.lower()}.bat"


def _box(lines: list[str]) -> None:
    width = max(len(line) for line in lines) + 4
    print("\n" + "=" * width)
    for line in lines:
        print(f"  {line}")
    print("=" * width + "\n", flush=True)


def _is_listening(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def _can_bind(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _health(port: int, timeout: float = 1.0) -> dict | None:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=timeout) as r:
            data = json.loads(r.read())
            return data if isinstance(data, dict) else None
    except Exception:
        return None


def _port_owner(port: int) -> str | None:
    """Best-effort name of the program listening on `port` (Windows only)."""
    if os.name != "nt":
        return None
    try:
        netstat = subprocess.run(
            ["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True, timeout=5
        ).stdout
        for line in netstat.splitlines():
            parts = line.split()
            # Proto  Local Address  Foreign Address  State  PID
            if len(parts) >= 5 and parts[1].endswith(f":{port}") and parts[3].upper() == "LISTENING":
                pid = parts[4]
                tasklist = subprocess.run(
                    ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                    capture_output=True, text=True, timeout=5,
                ).stdout.strip()
                if tasklist.startswith('"'):
                    name = tasklist.split(",")[0].strip('"')
                    return f"{name}, PID {pid}"
                return f"PID {pid}"
    except Exception:
        pass
    return None


def choose_port() -> tuple[int | None, bool]:
    """Returns (port, already_running). port is None if nothing usable was found."""
    for port in range(BASE_PORT, BASE_PORT + PORT_RANGE + 1):
        if not _is_listening(port) and _can_bind(port):
            return port, False

        health = _health(port)
        if health and health.get("app") == APP_ID:
            if health.get("environment") == LME_ENV:
                return port, True
            who = f"the LME bridge for {health.get('environment')}"
        else:
            owner = _port_owner(port)
            who = f"another program ({owner})" if owner else "another program"
        print(f"Port {port} is already in use by {who}. Trying the next port...", flush=True)
    return None, False


def _open_when_ready(port: int) -> None:
    url = f"http://localhost:{port}/"
    # Bloomberg session start-up happens before the server accepts requests and
    # can take a while, so wait up to ~2 minutes.
    for _ in range(240):
        health = _health(port, timeout=0.5)
        if health and health.get("app") == APP_ID:
            _box([
                f"LME Bloomberg bridge ({LME_ENV}) is running at {url}",
                "Leave this window open while you are working.",
                "Closing it disconnects the LME Order Entry page.",
            ])
            webbrowser.open(url)
            return
        time.sleep(0.5)


def main() -> None:
    port, already_running = choose_port()

    if port is None:
        last = BASE_PORT + PORT_RANGE
        _box([
            "The LME Bloomberg bridge could not start.",
            "",
            f"Every port it can use ({BASE_PORT}-{last}) is taken by other programs.",
            "",
            "What to do:",
            "  1. Close any other 'LME Bloomberg Bridge' windows and try again.",
            "  2. If that doesn't help, restart the PC and run",
            f"     {START_SCRIPT} again.",
            "  3. Still stuck? Send IT a screenshot of this window.",
        ])
        try:
            input("Press Enter to close...")
        except EOFError:
            pass
        sys.exit(1)

    if already_running:
        url = f"http://localhost:{port}/"
        _box([
            f"The LME Bloomberg bridge ({LME_ENV}) is already running at {url}",
            "Opening the LME Order Entry page in your browser.",
            "Keep using the bridge window that was already open.",
            "This extra window can be closed.",
        ])
        webbrowser.open(url)
        return

    if port != BASE_PORT:
        print(f"Using port {port} instead.", flush=True)

    threading.Thread(target=_open_when_ready, args=(port,), daemon=True).start()

    # Imported only now, so a port problem never opens a Bloomberg session.
    import uvicorn
    from .main import app

    try:
        uvicorn.run(app, host="127.0.0.1", port=port)
    except SystemExit as exc:
        # uvicorn exits with code 1 if it can't bind (e.g. another program
        # grabbed the port in the moment between our check and the bind).
        if exc.code not in (0, None):
            _box([
                "The LME Bloomberg bridge stopped unexpectedly (see the messages above).",
                f"Close this window and run {START_SCRIPT} again.",
                "If it keeps happening, send IT a screenshot of this window.",
            ])
        raise


if __name__ == "__main__":
    main()
