"""One fighter's agentic loop: chat completions with tools until DONE or the
turn cap. Every observable action becomes an event the city animates."""

from __future__ import annotations

import json
from pathlib import Path

from .llm import chat
from .tools import TOOLS_SCHEMA, execute_tool
from .events import EventEmitter
from .sandbox import Sandbox

MAX_TURNS = 14
PROMPT = (Path(__file__).parent / "agents" / "fighter.md").read_text()


def _tool_label(name: str, args: dict) -> str:
    if name in ("read_file", "write_file"):
        return f"{name.split('_')[0]} {Path(args.get('path', '?')).name}"
    if name == "commit":
        return "commit"
    if name == "run_tests":
        return "run tests"
    return name.replace("_", " ")


def run_fighter(side: str, agent: str, task: str, sandbox: Sandbox,
                emitter: EventEmitter) -> dict:
    """Returns {commits, last_tests}. Emits tool.called / commit.pushed /
    tests.result / fighter.done along the way."""
    messages = [
        {"role": "system", "content": PROMPT},
        {"role": "user", "content": f"Task: {task}\n\nThe repo is checked out in your sandbox. Begin."},
    ]
    commits = 0
    last_tests: dict = {}

    for _ in range(MAX_TURNS):
        msg = chat(agent, messages, tools=TOOLS_SCHEMA)
        messages.append(msg)

        calls = msg.get("tool_calls") or []
        if not calls:
            content = (msg.get("content") or "").strip()
            if "DONE" in content.upper() or not content:
                break
            # Plain talk without tool call: nudge once toward tools
            messages.append({"role": "user",
                             "content": "Use the tools to act, or reply DONE if finished."})
            continue

        for call in calls:
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"]["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            emitter.emit("tool.called", side=side, tool=_tool_label(name, args))
            result = execute_tool(sandbox, name, args)

            if name == "commit" and result.get("sha"):
                commits += 1
                emitter.emit("commit.pushed", side=side, sha=result["sha"],
                             msg=(args.get("message", "update"))[:60])
            if name == "run_tests" and "passed" in result:
                last_tests = result
                emitter.emit("tests.result", side=side, ok=result["ok"],
                             passed=result["passed"], total=result["total"])

            messages.append({
                "role": "tool",
                "tool_call_id": call["id"],
                "content": json.dumps(result)[:20000],
            })

    # Safety net: commit any uncommitted work so the referee sees it
    sha = sandbox.commit_all("wip: end of fight")
    if sha:
        commits += 1
        emitter.emit("commit.pushed", side=side, sha=sha, msg="wip: end of fight")

    emitter.emit("fighter.done", side=side)
    return {"commits": commits, "last_tests": last_tests}
