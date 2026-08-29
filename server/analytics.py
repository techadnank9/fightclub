"""ClickHouse Cloud analytics sink for fight events.

Non-blocking by design: `record()` drops the event into a bounded in-memory
queue and returns immediately; a daemon thread batches and flushes with
JSONEachRow inserts over the HTTPS interface (stdlib urllib + certifi, same
custom User-Agent trick as harness/llm.py — Cloudflare rejects the default UA).

A failing or unconfigured ClickHouse must NEVER break a fight: if
CLICKHOUSE_HOST is missing from harness/.env the sink is a silent no-op, and
any insert failure logs once to stderr and drops the batch.
"""

from __future__ import annotations

import json
import queue
import ssl
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import certifi

ROOT = Path(__file__).resolve().parent.parent
_CTX = ssl.create_default_context(cafile=certifi.where())
_UA = "agent-fight-city/0.1"

_BATCH_MAX = 500          # rows per insert
_BATCH_WINDOW = 0.5       # seconds to wait for more rows before flushing
_QUEUE_MAX = 10_000       # drop (never block) beyond this backlog


def _load_env() -> dict:
    # Process environment first (deployments), .env fills the gaps (local dev)
    import os
    env: dict = dict(os.environ)
    env_file = ROOT / "harness" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip())
    return env


class _Sink:
    def __init__(self) -> None:
        env = _load_env()
        self.host = env.get("CLICKHOUSE_HOST", "")
        self.user = env.get("CLICKHOUSE_USER", "default")
        self.password = env.get("CLICKHOUSE_PASSWORD", "")
        self.enabled = bool(self.host)
        self._queue: queue.Queue = queue.Queue(maxsize=_QUEUE_MAX)
        self._warned = False
        if self.enabled:
            threading.Thread(target=self._run, daemon=True,
                             name="clickhouse-sink").start()

    # -- public ----------------------------------------------------------

    def record(self, session_id: str, event: dict) -> None:
        if not self.enabled:
            return
        row = {
            "ts": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            "session": session_id,
            "type": str(event.get("type", "")),
            "side": str(event.get("side", "") or ""),
            "payload": json.dumps(event, separators=(",", ":")),
        }
        try:
            self._queue.put_nowait(row)
        except queue.Full:
            pass  # backlogged: drop rather than block a fight

    def query(self, sql: str, timeout: float = 15.0) -> str:
        """Synchronous query; raises on any failure (caller handles 503)."""
        if not self.enabled:
            raise RuntimeError("ClickHouse is not configured (no CLICKHOUSE_HOST)")
        return self._http(sql, timeout=timeout)

    # -- background flush ------------------------------------------------

    def _run(self) -> None:
        while True:
            rows = [self._queue.get()]
            deadline = time.monotonic() + _BATCH_WINDOW
            while len(rows) < _BATCH_MAX:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    rows.append(self._queue.get(timeout=remaining))
                except queue.Empty:
                    break
            self._flush(rows)

    def _flush(self, rows: list[dict]) -> None:
        body = ("\n".join(json.dumps(r) for r in rows) + "\n").encode()
        try:
            self._http("INSERT INTO fight_events FORMAT JSONEachRow",
                       data=body, timeout=10)
        except Exception as exc:  # noqa: BLE001 — any failure means drop, not crash
            if not self._warned:
                print(f"[analytics] ClickHouse insert failed; dropping events: {exc}",
                      file=sys.stderr)
                self._warned = True

    def _http(self, sql: str, data: bytes | None = None,
              timeout: float = 10.0) -> str:
        url = (f"https://{self.host}:8443/?"
               + urllib.parse.urlencode({"query": sql}))
        req = urllib.request.Request(
            url, data=data, method="POST",
            headers={
                "User-Agent": _UA,
                "X-ClickHouse-User": self.user,
                "X-ClickHouse-Key": self.password,
            })
        with urllib.request.urlopen(req, context=_CTX, timeout=timeout) as resp:
            return resp.read().decode()


_sink = _Sink()


def record(session_id: str, event: dict) -> None:
    """Buffer one fight event for ClickHouse. Never raises, never blocks."""
    try:
        _sink.record(session_id, event)
    except Exception:  # noqa: BLE001 — analytics must never break a fight
        pass


def query(sql: str) -> str:
    """Run a read query against ClickHouse. Raises when unreachable/unconfigured."""
    return _sink.query(sql)
