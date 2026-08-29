"""Referee: judges both branches from a clean fourth sandbox.

Fairness rules (the whole point):
- Tests come from MAIN's checkout, never the fighter's tree, so a fighter
  that edited tests is judged by the originals anyway.
- The diff review runs on each branch's diff vs origin/main.
- Qodo reviews the winner's PR via the GitHub app on the repo (installed);
  the referee's own findings come from an LLM pass with the referee prompt
  and feed the score alongside the original-suite run.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from .llm import chat
from .tools import run_pytest
from .scoring import score, formula_text
from .events import EventEmitter
from .sandbox import Sandbox, _run

PROMPT = (Path(__file__).parent / "agents" / "referee.md").read_text()


def _original_tests_from_main(ref_sandbox: Sandbox) -> Path:
    """Copy tests/ (and conftest) as they exist on main into a temp dir."""
    _run(["git", "checkout", "origin/main", "--", "."], cwd=ref_sandbox.path)
    keep = tempfile.mkdtemp(prefix="orig-tests-")
    src = ref_sandbox.path / "tests"
    if src.exists():
        shutil.copytree(src, Path(keep) / "tests")
    for extra in ("conftest.py", "pytest.ini", "pyproject.toml"):
        p = ref_sandbox.path / extra
        if p.exists():
            shutil.copy(p, keep)
    return Path(keep)


def _judge_branch(ref_sandbox: Sandbox, branch: str, original_tests: Path) -> dict:
    """Check out the branch in the referee clone, overlay ORIGINAL tests, run."""
    _run(["git", "fetch", "origin", branch], cwd=ref_sandbox.path)
    _run(["git", "checkout", "-f", f"origin/{branch}"], cwd=ref_sandbox.path)
    # Overlay main's tests over whatever the fighter did to them
    dst = ref_sandbox.path / "tests"
    if (original_tests / "tests").exists():
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(original_tests / "tests", dst)
    result = run_pytest(ref_sandbox.path)
    num, diff = _diff_vs_main(ref_sandbox)
    return {"tests": result, "diff_lines": num, "diff": diff}


def _diff_vs_main(sb: Sandbox) -> tuple[int, str]:
    num = _run(["git", "diff", "--numstat", "origin/main", "HEAD", "--", ".", ":!tests"],
               cwd=sb.path).stdout
    total = 0
    for line in num.splitlines():
        parts = line.split("\t")
        for p in parts[:2]:
            if p.isdigit():
                total += int(p)
    diff = _run(["git", "diff", "origin/main", "HEAD"], cwd=sb.path).stdout
    return total, diff[:40000]


def _review_findings(task: str, diff: str) -> list[dict]:
    msg = chat("referee", [
        {"role": "system", "content": PROMPT},
        {"role": "user", "content": f"Task: {task}\n\nDiff:\n{diff[:24000]}"},
    ], max_tokens=700)
    text = msg.get("content") or "{}"
    m = re.search(r"\{.*\}", text, re.S)
    try:
        return json.loads(m.group(0))["findings"] if m else []
    except (json.JSONDecodeError, KeyError):
        return []


def run_referee(session: str, task: str, target_repo: str,
                branches: dict, emitter: EventEmitter,
                open_pr: bool = True) -> dict:
    ref = Sandbox(session, "ref", target_repo).create()
    emitter.emit("referee.spawned", sandbox=f"sb-ref-{session.split('-')[-1]}")

    original_tests = _original_tests_from_main(ref)
    results = {}
    for side in ("a", "b"):
        judged = _judge_branch(ref, branches[side], original_tests)
        findings = _review_findings(task, judged["diff"])
        for f in findings:
            emitter.emit("referee.finding", side=side,
                         severity=f.get("severity", "low"), msg=f.get("msg", "")[:120])
        judged["findings"] = findings
        judged["score"] = score(judged["tests"]["passed"], judged["tests"]["total"],
                                findings, judged["diff_lines"])
        results[side] = judged

    winner = "a" if results["a"]["score"] >= results["b"]["score"] else "b"
    loser = "b" if winner == "a" else "a"

    pr_number = None
    if open_pr:
        pr_number = _open_pr_and_cleanup(ref, task, branches, winner, loser, results)

    emitter.emit("verdict", winner=winner,
                 score={"a": results["a"]["score"], "b": results["b"]["score"]},
                 pr=pr_number, deleted=branches[loser])
    return {"winner": winner, "results": results, "pr": pr_number}


def _open_pr_and_cleanup(ref: Sandbox, task: str, branches: dict,
                         winner: str, loser: str, results: dict) -> int | None:
    body = (
        f"Fight verdict: **{winner.upper()} wins** "
        f"{results[winner]['score']}-{results[loser]['score']}\n\n"
        f"### Scoring\n```\n{formula_text(results[winner]['tests']['passed'], results[winner]['tests']['total'], results[winner]['findings'], results[winner]['diff_lines'])}\n```\n\n"
        f"Loser branch `{branches[loser]}` deleted by the referee.\n\n"
        "Opened automatically by the Agent Fight City referee. Qodo review requested."
    )
    try:
        out = subprocess.run(
            ["gh", "pr", "create", "--head", branches[winner], "--base", "main",
             "--title", f"fight: {task[:60]}", "--body", body],
            cwd=ref.path, capture_output=True, text=True, timeout=60)
        pr_number = None
        m = re.search(r"/pull/(\d+)", out.stdout + out.stderr)
        if m:
            pr_number = int(m.group(1))
        subprocess.run(["git", "push", "origin", "--delete", branches[loser]],
                       cwd=ref.path, capture_output=True, text=True, timeout=60)
        return pr_number
    except Exception:
        return None
