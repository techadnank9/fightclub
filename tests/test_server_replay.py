"""Phase 2 done-when check, as a test: the server replays the saved JSONL log
and the SSE stream carries exactly the recorded events, in order."""

import asyncio
import json

import httpx
import pytest

from server.app import app


@pytest.mark.asyncio
async def test_replay_streams_full_fight():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        r = await client.post("/fight", json={
            "repo": "rust-lang/rust", "task": "x", "a": "sonnet", "b": "gpt",
            "replay": "tests/fixtures/sample_fight.jsonl", "speed": 1000.0,
        })
        assert r.status_code == 200
        session = r.json()["session"]

        events = []
        async with client.stream("GET", f"/events?session={session}", timeout=30) as resp:
            assert resp.status_code == 200
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    events.append(json.loads(line[6:]))
                    if events[-1]["type"] == "session.closed":
                        break

    with open("tests/fixtures/sample_fight.jsonl") as f:
        expected = [json.loads(l) for l in f if l.strip()]
    assert [e["type"] for e in events] == [e["type"] for e in expected]
    assert events[0]["repo"] == "rust-lang/rust"
    verdict = next(e for e in events if e["type"] == "verdict")
    assert verdict["winner"] == "a"


@pytest.mark.asyncio
async def test_repos_endpoint_serves_seed():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        r = await client.get("/repos")
        assert r.status_code == 200
        assert len(r.json()["repos"]) > 0


@pytest.mark.asyncio
async def test_unknown_session_404():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        r = await client.get("/events?session=nope")
        assert r.status_code == 404
