"""Fight orchestrator. Entry:

  python -m harness.fight --repo owner/name --task "..." --a sonnet --b gpt \
      --target <throwaway repo url or local path> [--no-pr]

Emits the event JSONL on stdout (the server pipes this straight to the
frontend). --repo is the DISPLAY repo (which city building animates);
--target is the throwaway repo the fighters actually clone and push to.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import re
import secrets
import subprocess
import sys
import time

from .events import EventEmitter
from .sandbox import Sandbox
from .agent_loop import run_fighter
from .referee import run_referee
from .llm import ENV


def fork_of(repo: str) -> str | None:
    """Fork repo into the signed-in account (idempotent) and return the fork URL.
    Fights then run entirely on the fork — upstream never sees a bot PR."""
    try:
        me = subprocess.run(["gh", "api", "user", "--jq", ".login"],
                            capture_output=True, text=True, timeout=30).stdout.strip()
        if not me:
            return None
        subprocess.run(["gh", "repo", "fork", repo, "--clone=false"],
                       capture_output=True, text=True, timeout=120)
        name = repo.split("/")[1]
        for _ in range(10):  # forking is async on GitHub's side
            ok = subprocess.run(["gh", "api", f"repos/{me}/{name}", "--jq", ".full_name"],
                                capture_output=True, text=True, timeout=30)
            if ok.returncode == 0 and ok.stdout.strip():
                return f"https://github.com/{me}/{name}.git"
            time.sleep(3)
    except Exception:
        pass
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="display repo shown in the city")
    ap.add_argument("--task", required=True)
    ap.add_argument("--a", default="sonnet")
    ap.add_argument("--b", default="gpt")
    ap.add_argument("--target", default=ENV.get("TARGET_REPO"),
                    help="throwaway repo the fighters clone/push (URL or path)")
    ap.add_argument("--no-pr", action="store_true")
    ap.add_argument("--fork", action="store_true",
                    help="fork --repo into the signed-in account and fight on the fork "
                         "(PR opens on the fork, never upstream)")
    ap.add_argument("--log", default=None, help="also append events to this JSONL file")
    args = ap.parse_args()

    if args.fork:
        args.target = fork_of(args.repo)
        if not args.target:
            print(f"could not fork {args.repo}", file=sys.stderr)
            return 2
    if not args.target:
        print("no --target and no TARGET_REPO in env", file=sys.stderr)
        return 2

    fight_id = secrets.token_hex(2)
    session = f"fight-{fight_id}"
    emitter = EventEmitter(args.log)

    emitter.emit("session.opened", session=session, repo=args.repo, task=args.task)

    branches = {"a": f"fight/a-{fight_id}", "b": f"fight/b-{fight_id}"}

    def fighter(side: str, agent: str):
        try:
            sb = Sandbox(session, side, args.target).create()
            sb.checkout_branch(branches[side])
            emitter.emit("fighter.started", side=side, agent=agent,
                         sandbox=f"sb-{side}-{fight_id}", branch=branches[side])
            result = run_fighter(side, agent, args.task, sb, emitter)
            sb.push_branch()
            return result
        except Exception as e:  # a crashing fighter forfeits, the fight goes on
            print(f"fighter {side} crashed: {e!r}", file=sys.stderr)
            emitter.emit("fighter.done", side=side)
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        fa = pool.submit(fighter, "a", args.a)
        fb = pool.submit(fighter, "b", args.b)
        results = {"a": fa.result(), "b": fb.result()}

    run_referee(session, args.task, args.target, branches, emitter,
                open_pr=not args.no_pr,
                forfeits={s for s, r in results.items() if r is None})

    time.sleep(0.2)
    emitter.emit("session.closed")
    emitter.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
