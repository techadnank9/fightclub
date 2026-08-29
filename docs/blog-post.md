# We made AI agents fight for the right to open a pull request

*Building Agent Fight City in one day: a 3D city where every building is a GitHub repo, two AI agents battle to fix the same bug, and a referee opens the winner's PR and deletes the loser's branch.*

**Live demo:** https://agentfightclub.vercel.app · **Code:** https://github.com/techadnank9/fightclub

---

## The pitch

Benchmarks tell you which model is better on average. Nobody ships "on average." The question that actually matters at 2am is: *which agent fixes THIS bug in MY repo without wrecking anything else?*

So we built an arena for it. Every building in our 3D night city is a real GitHub repo — height proportional to its actual star count, windows lit by commit activity, a neon sign for its language. Click a building, pick one of its open issues, choose two fighters (Claude via the TrueFoundry gateway, GPT via OpenAI, Gemini via Vertex). Each agent gets its own sandboxed git clone and its own branch. Then you watch:

- every **commit** an agent pushes drops a floor onto its tower, squash-and-stretch and all
- every **test run** pulses the tower windows green or red
- when both are done, a **referee** in a hard hat walks into the arena, re-runs the repo's *original* test suite against both branches, reviews both diffs, and fills in a live scorecard: 60% original tests, 25% review findings, 15% diff economy
- the winner gets a crane-lowered crown and a real pull request on GitHub; the loser's tower collapses in dust and its branch is deleted

Every fight is a stream of ten JSONL event types. The frontend contains zero fight logic — it's a pure renderer of that contract, which is also why every fight is replayable with a scrubber, like game film.

## How it's wired

**The harness** is Python: an orchestrator spawns fighter A and fighter B in parallel threads, each in an isolated shallow clone, each running a chat-completions tool loop (list_files, read_file, write_file, run_tests, commit — up to 14 turns). Fighter A and the referee run through the **TrueFoundry AI gateway**, fighter B on direct OpenAI, and we later added Gemini through Vertex — a genuinely cross-provider fight where swapping a model is a one-string change and every token shows up in one dashboard.

**The referee** is deliberately paranoid. It judges from a clean fourth clone, fetches each fighter's branch, and overlays the test suite *from main* — plus main's `conftest.py`, `pytest.ini`, and `pyproject.toml` — before running anything. A fighter that edits its own tests gains exactly nothing. Review findings feed 25% of the score. The winner's PR body includes the scoring formula; the loser's branch is deleted only after the PR actually opens.

**The city data** comes from **Bright Data**, not the GitHub API — the point was a scraping pipeline that survives the web changing. Stars, commit counts, and open issues are pulled from live GitHub pages through the Web Unlocker, validated against a committed schema, with an ordered ladder of fallback parse patterns per field and a versioned heal log that records what broke and what rescued it.

**Quality gate:** every PR to our own repo went through **Qodo** before merge. More on that below, because it earned its slot.

**The stats** stream into ClickHouse Cloud — every event of every fight, with a `/stats` endpoint for win rates by agent.

## What broke along the way

This is the honest part, and honestly the fun part.

**Cloudflare hated our User-Agent.** The TrueFoundry gateway sits behind Cloudflare, which returns `403 error code: 1010` for Python's default urllib UA. One custom User-Agent string later, everything worked. Hours of confusion available for the low price of one HTTP header.

**A shallow clone's fetch doesn't do what you think.** The referee kept crashing on `git checkout origin/fight/a-7883`. On a shallow clone, a bare `git fetch origin <branch>` writes only `FETCH_HEAD` — `origin/<branch>` never comes into existence. You need an explicit refspec: `+refs/heads/x:refs/remotes/origin/x`.

**The referee caught our fighters committing `__pycache__`.** We didn't tell it to look for that. The review pass flagged "committed .pyc files" on both fighters in the very first real fight — a finding we then had to fix in our own sandbox code. The judge we built immediately judged us.

**Our fix for that caused a double forfeit.** Excluding bytecode from `git add` meant `git status` showed changes while nothing was staged, so the end-of-fight safety commit exited 1, both fighters registered as crashed, and a real fight ended 0–0. Lesson: check `git diff --cached --quiet`, not `git status`, before committing.

**One bad tween froze the entire city.** Our animation engine looped through active tweens; a single tween that threw (it referenced a scaffold that had been cleaned up) aborted the loop and froze every animation on screen — which looked like "the loser's tower refuses to collapse." The fix: a throwing tween gets dropped, never re-run.

**GitHub's 2026 markup fought back.** The repo page no longer server-renders the language sidebar at all — it's a client-side skeleton. And every page that *does* carry language (org listings, profile tabs, search) turned out to be robots.txt-blocked for no-KYC residential access through the unlocker. The scraper adapted: language is carried as static metadata, the live numbers (stars, commits, issues) keep flowing, and the heal log documents the whole episode with timestamps.

**Qodo found ten real bugs in our backend PR.** Three highs: fighters could control pytest configuration and game the referee's scoring; the loser's branch got deleted even when the winner's PR failed to open (destroying work with nothing to show for it); and a path traversal in the replay endpoint. Plus seven mediums we'd have shipped without noticing, like the SSE client killing the browser's reconnect on the first blip. We fixed all ten before merging. A hackathon repo with a real review gate feels weird and correct.

## The part we're proudest of

The demo never lies. If you open the site with no backend keys, clicking START FIGHT replays the recording of a real fight — the actual sonnet-vs-gemini session that opened PR #2 on our arena repo, real commit SHAs and all. Gemini pushed a zero-line diff and lost 76–85. It earned that.

And the referee's verdict isn't a vibe: the in-app scorecard shows exactly why someone won — original tests passed, findings and their severity, diff size — as it happens. If we want humans to trust agents doing real work, the least the agents can do is show their work.

## What's next

Fork mode already lets fights run on a fork of any public repo (PRs stay on the fork — nobody's upstream gets bot spam). The obvious next step is fight cards for your own backlog: point the city at your org, and let the agents settle who fixes what.

*Built in one day for the hackathon. The full break-by-break log lives in [BLOG.md](../BLOG.md) in the repo.*
