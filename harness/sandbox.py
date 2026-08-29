"""Sandboxes: one isolated git clone per fighter, plus a clean one for the
referee. Local directories under .fights/<session>/ — cheap, disposable, and
each fighter can only touch its own tree.

The target repo is a THROWAWAY repo we own (see CLAUDE.md phase 3). Never
point this at a real upstream project.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

FIGHTS_DIR = Path(".fights")


def _run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


class Sandbox:
    def __init__(self, session: str, name: str, target_repo: str):
        self.session = session
        self.name = name                      # "a" | "b" | "ref"
        self.target_repo = target_repo        # URL or local path
        self.path = FIGHTS_DIR / session / name
        self.branch: str | None = None

    def create(self) -> "Sandbox":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            shutil.rmtree(self.path)
        _run(["git", "clone", "--depth", "20", self.target_repo, str(self.path)])
        return self

    def checkout_branch(self, branch: str) -> None:
        self.branch = branch
        _run(["git", "checkout", "-b", branch], cwd=self.path)

    def commit_all(self, message: str) -> str | None:
        """Stage everything and commit. Returns short sha, or None if nothing changed."""
        _run(["git", "add", "-A"], cwd=self.path)
        st = _run(["git", "status", "--porcelain"], cwd=self.path)
        if not st.stdout.strip():
            return None
        _run(["git", "-c", "user.email=fighter@fight.city", "-c", "user.name=Fighter " + self.name,
              "commit", "-m", message], cwd=self.path)
        sha = _run(["git", "rev-parse", "--short", "HEAD"], cwd=self.path).stdout.strip()
        return sha

    def push_branch(self) -> None:
        assert self.branch
        _run(["git", "push", "-u", "origin", self.branch, "--force"], cwd=self.path)

    def diff_stat(self, base: str = "origin/main") -> tuple[int, str]:
        """Lines changed vs base and the full diff text."""
        num = _run(["git", "diff", "--numstat", base, "HEAD"], cwd=self.path).stdout
        total = 0
        for line in num.splitlines():
            parts = line.split("\t")
            if len(parts) >= 2:
                for p in parts[:2]:
                    if p.isdigit():
                        total += int(p)
        diff = _run(["git", "diff", base, "HEAD"], cwd=self.path).stdout
        return total, diff

    def destroy(self) -> None:
        if self.path.exists():
            shutil.rmtree(self.path)
