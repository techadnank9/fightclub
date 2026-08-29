import json

import pytest

from harness.events import EventEmitter, EVENT_TYPES


def test_emit_unknown_type_rejected():
    with pytest.raises(ValueError):
        EventEmitter().emit("fighter.jumped")


def test_emit_writes_jsonl(tmp_path, capsys):
    log = tmp_path / "log.jsonl"
    em = EventEmitter(str(log))
    em.emit("session.opened", session="s1", repo="o/r", task="t")
    em.emit("session.closed")
    em.close()
    lines = log.read_text().strip().splitlines()
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first["type"] == "session.opened"
    assert first["repo"] == "o/r"
    assert "ts" in first
    # stdout mirrors the file
    out_lines = capsys.readouterr().out.strip().splitlines()
    assert len(out_lines) == 2


def test_fixture_only_uses_documented_types():
    with open("tests/fixtures/sample_fight.jsonl") as f:
        for line in f:
            assert json.loads(line)["type"] in EVENT_TYPES
