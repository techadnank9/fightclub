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
from .scoring import score, formula_text, components
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
    # Explicit refspec: a bare `fetch origin <branch>` on a shallow clone only
    # writes FETCH_HEAD and origin/<branch> never exists (see BLOG.md).
    _run(["git", "fetch", "origin", f"+refs/heads/{branch}:refs/remotes/origin/{branch}"],
         cwd=ref_sandbox.path)
    _run(["git", "checkout", "-f", f"origin/{branch}"], cwd=ref_sandbox.path)
    # Overlay main's tests AND pytest config over whatever the fighter did:
    # a branch-controlled conftest/pytest.ini could skip the original suite.
    dst = ref_sandbox.path / "tests"
    if (original_tests / "tests").exists():
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(original_tests / "tests", dst)
    for extra in ("conftest.py", "pytest.ini", "pyproject.toml"):
        saved = original_tests / extra
        target = ref_sandbox.path / extra
        if saved.exists():
            shutil.copy(saved, target)
        elif target.exists():
            target.unlink()   # fighter added config main never had
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
                open_pr: bool = True, forfeits: set | None = None) -> dict:
    ref = Sandbox(session, "ref", target_repo).create()
    emitter.emit("referee.spawned", sandbox=f"sb-ref-{session.split('-')[-1]}")
    forfeits = forfeits or set()

    original_tests = _original_tests_from_main(ref)
    results = {}
    for side in ("a", "b"):
        if side in forfeits:
            emitter.emit("referee.finding", side=side, severity="high",
                         msg="fighter crashed mid-fight: forfeit")
            results[side] = {"tests": {"ok": False, "passed": 0, "total": 1},
                             "diff_lines": 0, "findings": [{"severity": "high", "msg": "forfeit"}],
                             "score": 0}
            continue
        judged = _judge_branch(ref, branches[side], original_tests)
        t = judged["tests"]
        emitter.emit("tests.result", side=side, ok=t["ok"], passed=t["passed"],
                     total=t["total"], by="referee")
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
        m = re.search(r"github\.com[:/]+([^/]+/[^/.]+)", target_repo)
        slug = m.group(1) if m else None
        pr_number = _open_pr_and_cleanup(ref, task, branches, winner, loser, results, slug)

    breakdown = {}
    for side in ("a", "b"):
        r = results[side]
        breakdown[side] = components(r["tests"]["passed"], r["tests"]["total"],
                                     r["findings"], r["diff_lines"])
    emitter.emit("verdict", winner=winner,
                 score={"a": results["a"]["score"], "b": results["b"]["score"]},
                 breakdown=breakdown,
                 pr=pr_number, deleted=branches[loser])
    return {"winner": winner, "results": results, "pr": pr_number}


def _open_pr_and_cleanup(ref: Sandbox, task: str, branches: dict,
                         winner: str, loser: str, results: dict,
                         slug: str | None = None) -> int | None:
    body = (
        f"Fight verdict: **{winner.upper()} wins** "
        f"{results[winner]['score']}-{results[loser]['score']}\n\n"
        f"### Scoring\n```\n{formula_text(results[winner]['tests']['passed'], results[winner]['tests']['total'], results[winner]['findings'], results[winner]['diff_lines'])}\n```\n\n"
        f"Loser branch `{branches[loser]}` deleted by the referee.\n\n"
        "Opened automatically by the Agent Fight City referee. Qodo review requested."
    )
    try:
        cmd = ["gh", "pr", "create", "--head", branches[winner], "--base", "main",
               "--title", f"fight: {task[:60]}", "--body", body]
        if slug:
            # Pin the PR to the target repo: on a fork, gh would otherwise
            # open it against the UPSTREAM parent, which we never do.
            cmd += ["--repo", slug]
        out = subprocess.run(cmd, cwd=ref.path, capture_output=True, text=True, timeout=60)
        pr_number = None
        m = re.search(r"/pull/(\d+)", out.stdout + out.stderr)
        if m:
            pr_number = int(m.group(1))
        if pr_number is None:
            # PR did not open (transient gh/GitHub failure): keep BOTH branches
            # so nothing is lost; the verdict will show no PR number.
            return None
        subprocess.run(["git", "push", "origin", "--delete", branches[loser]],
                       cwd=ref.path, capture_output=True, text=True, timeout=60)
        return pr_number
    except Exception:
        return None
