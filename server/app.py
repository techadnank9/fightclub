"""Agent Fight City server.

  uvicorn server.app:app --port 8000

- POST /fight {repo, task, a, b}    -> {"session": id}; spawns the harness
  (or replays a JSONL fixture when replay is requested / no target repo set).
- GET  /events?session=<id>          -> SSE stream of the fight's events.
- GET  /repos                        -> city/data/repos.json (falls back to
  the committed seed in web/data/repos.json).
- /                                  -> serves web/ (the Three.js frontend).

The server holds NO fight logic: it pipes harness stdout JSONL to the
browser. Late subscribers get the full event history first, then live events
(the frontend POSTs /fight before opening the EventSource, so without the
history replay it would miss session.opened).
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent

app = FastAPI(title="agent-fight-city")


class Session:
    def __init__(self, sid: str):
        self.id = sid
        self.history: list[dict] = []
        self.queues: list[asyncio.Queue] = []
        self.done = False

    def publish(self, event: dict) -> None:
        self.history.append(event)
        if event.get("type") == "session.closed":
            self.done = True
        for q in list(self.queues):
            q.put_nowait(event)


SESSIONS: dict[str, Session] = {}


def _env() -> dict:
    env = {}
    env_file = ROOT / "harness" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


async def _pump_subprocess(session: Session, cmd: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=ROOT,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    assert proc.stdout
    async for raw in proc.stdout:
        line = raw.decode(errors="replace").strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        session.publish(event)
    await proc.wait()
    if not session.done:
        # Harness died without closing: tell the frontend anyway.
        session.publish({"type": "session.closed"})


async def _pump_replay(session: Session, log_path: Path, speed: float = 1.0) -> None:
    """Replay a saved JSONL log honoring recorded ts spacing (capped)."""
    events = []
    for line in log_path.read_text().splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    prev_ts = None
    for ev in events:
        ts = ev.get("ts")
        if prev_ts is not None and ts is not None:
            gap = min(3.0, max(0.05, (ts - prev_ts) / speed))
            await asyncio.sleep(gap)
        prev_ts = ts
        session.publish(ev)
    if not session.done:
        session.publish({"type": "session.closed"})


@app.post("/fight")
async def start_fight(request: Request):
    body = await request.json()
    sid = uuid.uuid4().hex[:8]
    session = Session(sid)
    SESSIONS[sid] = session

    replay = body.get("replay")
    env = _env()
    if not replay and not env.get("TARGET_REPO"):
        # No throwaway repo configured yet: fall back to the recorded fixture
        # so the full pipeline still demos end to end.
        replay = "tests/fixtures/sample_fight.jsonl"

    if replay:
        path = ROOT / replay
        if not path.exists():
            raise HTTPException(404, f"no such replay log: {replay}")
        asyncio.create_task(_pump_replay(session, path, float(body.get("speed", 1.0))))
    else:
        cmd = [sys.executable, "-m", "harness.fight",
               "--repo", body["repo"], "--task", body["task"],
               "--a", body.get("a", "sonnet"), "--b", body.get("b", "gpt"),
               "--log", str(ROOT / ".fights" / f"{sid}.jsonl")]
        asyncio.create_task(_pump_subprocess(session, cmd))

    return {"session": sid}


@app.get("/events")
async def events(session: str):
    sess = SESSIONS.get(session)
    if not sess:
        raise HTTPException(404, "unknown session")

    async def stream():
        q: asyncio.Queue = asyncio.Queue()
        # History first (late join), then live.
        for ev in sess.history:
            yield f"data: {json.dumps(ev)}\n\n"
        if sess.done:
            return
        sess.queues.append(q)
        try:
            while True:
                ev = await q.get()
                yield f"data: {json.dumps(ev)}\n\n"
                if ev.get("type") == "session.closed":
                    return
        finally:
            if q in sess.queues:
                sess.queues.remove(q)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache"})


@app.get("/repos")
async def repos():
    for candidate in (ROOT / "city" / "data" / "repos.json",
                      ROOT / "web" / "data" / "repos.json"):
        if candidate.exists():
            return JSONResponse(json.loads(candidate.read_text()))
    raise HTTPException(404, "no repos.json yet")


@app.get("/")
async def index():
    return FileResponse(ROOT / "web" / "index.html")


app.mount("/", StaticFiles(directory=ROOT / "web"), name="web")
