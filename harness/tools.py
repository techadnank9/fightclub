"""Fighter tools. Each tool runs inside one sandbox and cannot escape it —
every path is resolved and checked against the sandbox root.

The tool schema (OpenAI function-calling format) is what both providers see.
run_tests executes the sandbox's own pytest; the referee re-runs the ORIGINAL
suite separately, so a fighter gaming its local tests still loses.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

TOOLS_SCHEMA = [
    {"type": "function", "function": {
        "name": "list_files",
        "description": "List all files in the repository (paths relative to repo root).",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "read_file",
        "description": "Read one file.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"}}, "required": ["path"]},
    }},
    {"type": "function", "function": {
        "name": "write_file",
        "description": "Write (create or overwrite) one file with the given content.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"]},
    }},
    {"type": "function", "function": {
        "name": "run_tests",
        "description": "Run the test suite (pytest). Returns pass/fail counts and output tail.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "commit",
        "description": "Commit all current changes with a short message. Do this after each meaningful change.",
        "parameters": {"type": "object", "properties": {
            "message": {"type": "string"}}, "required": ["message"]},
    }},
]


def _safe(root: Path, rel: str) -> Path:
    p = (root / rel).resolve()
    if not str(p).startswith(str(root.resolve())):
        raise ValueError(f"path escapes sandbox: {rel}")
    return p


def run_pytest(cwd: Path, timeout: int = 120) -> dict:
    """Run pytest and parse counts. ok = zero failures AND at least one test ran."""
    try:
        proc = subprocess.run(
            ["python3", "-m", "pytest", "-q", "--no-header", "-x" if False else "--tb=line"],
            cwd=cwd, capture_output=True, text=True, timeout=timeout,
        )
        out = (proc.stdout + proc.stderr)[-2500:]
    except subprocess.TimeoutExpired:
        return {"ok": False, "passed": 0, "total": 0, "output": "pytest timed out"}
    import re
    passed = failed = errors = 0
    m = re.search(r"(\d+) passed", out)
    if m: passed = int(m.group(1))
    m = re.search(r"(\d+) failed", out)
    if m: failed = int(m.group(1))
    m = re.search(r"(\d+) error", out)
    if m: errors = int(m.group(1))
    total = passed + failed + errors
    return {"ok": failed == 0 and errors == 0 and passed > 0,
            "passed": passed, "total": total, "output": out}


def execute_tool(sandbox, name: str, args: dict) -> dict:
    root = sandbox.path
    if name == "list_files":
        files = [str(p.relative_to(root)) for p in root.rglob("*")
                 if p.is_file() and ".git" not in p.parts]
        return {"files": files[:400]}
    if name == "read_file":
        p = _safe(root, args["path"])
        if not p.exists():
            return {"error": f"no such file: {args['path']}"}
        return {"content": p.read_text(errors="replace")[:24000]}
    if name == "write_file":
        p = _safe(root, args["path"])
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(args["content"])
        return {"written": args["path"], "bytes": len(args["content"])}
    if name == "run_tests":
        return run_pytest(root)
    if name == "commit":
        sha = sandbox.commit_all(args.get("message", "update"))
        return {"sha": sha} if sha else {"error": "nothing to commit"}
    return {"error": f"unknown tool {name}"}
