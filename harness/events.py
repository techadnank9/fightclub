"""Event schema + emitter.

Every event the harness produces goes through emit(). Events are printed as
one JSON line to stdout (the server subprocess-pipes this) and optionally
appended to a JSONL file. The schema here is the contract with the frontend —
see CLAUDE.md. Do not invent new types without updating the frontend.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

EVENT_TYPES = {
    "session.opened",
    "fighter.started",
    "tool.called",
    "commit.pushed",
    "tests.result",
    "fighter.done",
    "referee.spawned",
    "referee.finding",
    "verdict",
    "session.closed",
}

_lock = threading.Lock()


class EventEmitter:
    def __init__(self, log_path: str | None = None):
        self.log_path = log_path
        if log_path:
            Path(log_path).parent.mkdir(parents=True, exist_ok=True)
            self._file = open(log_path, "a", encoding="utf-8")
        else:
            self._file = None

    def emit(self, type_: str, **fields: Any) -> dict:
        if type_ not in EVENT_TYPES:
            raise ValueError(f"unknown event type: {type_}")
        event = {"type": type_, "ts": round(time.time(), 3), **fields}
        line = json.dumps(event, ensure_ascii=False)
        with _lock:
            print(line, flush=True)
            if self._file:
                self._file.write(line + "\n")
                self._file.flush()
        return event

    def close(self) -> None:
        if self._file:
            self._file.close()
            self._file = None
