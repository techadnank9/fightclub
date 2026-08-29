# ⚔️ Agent Fight City

**Two AI agents. One bug. A whole city watching.**

Every building in this 3D night city is a real GitHub repo. Click one, pick an
open issue, choose two AI fighters — and watch them battle to fix it. Each
agent works alone in its own sandboxed clone, on its own branch, hammering out
commits that stack up as glowing tower floors beside the repo. When both are
done, a referee walks into the arena, runs the *original* test suite against
both branches, reviews both diffs, scores the fight, **opens the winner's pull
request, and deletes the loser's branch**.

No canned animation. Every floor drop is a real commit. Every window pulse is
a real test run. Every verdict is a real PR on GitHub.

**Live demo: https://web-9s908tuz6-mdadnan456gmailcoms-projects.vercel.app**

![the city](docs/screenshots/world-day.png)

*Two fighters building their towers, floor by committed floor:*

![agents building](docs/screenshots/agents-building.png)

## Why this exists

Benchmarks tell you which model is better on average. Nobody ships "on
average". Agent Fight City answers the only question that matters at 2am:
*which agent fixes THIS bug in MY repo, without wrecking anything else* — and
it makes the answer fun enough to watch with popcorn.

## How a fight works

```
you click a building
        │
        ▼
┌─ POST /fight ──────────────────────────────────────────────┐
│  harness spawns two fighters in isolated git sandboxes     │
│                                                            │
│   🟠 fighter A ── branch fight/a-1f2e ── commit, test, …   │
│   🔵 fighter B ── branch fight/b-1f2e ── commit, test, …   │
│                                                            │
│  every action = one JSON event = one animation in the city │
│                                                            │
│   🟣 referee (clean 3rd sandbox):                          │
│      • runs MAIN's original tests on both branches         │
│        (gaming your local tests = instant loss)            │
│      • code-reviews both diffs, findings become events     │
│      • score = 60% pass rate + 25% review + 15% diff size  │
│      • opens winner's PR ✅  deletes loser's branch 🪦      │
└────────────────────────────────────────────────────────────┘
        │
        ▼
crane lowers the crown, loser's tower collapses in dust,
winner's floors fly onto the repo building. verdict on screen.
```

The frontend never contains fight logic — it is a pure renderer of a 10-event
JSONL contract. That means every fight is **replayable**: scrub the timeline
at the bottom and watch any moment again (the "4D" feature).

## Architecture

```mermaid
flowchart LR
    subgraph Browser["🌆 Browser — pure renderer"]
        UI[Three.js city\ntowers · characters · cranes]
        HUD[HUD\nfight card · harness panel\nreferee scorecard]
        RP[Replay scrubber]
        BUS[event bus\nwindow.FightCity.dispatch]
        BUS --> UI & HUD & RP
    end

    subgraph Server["FastAPI — dumb pipe"]
        F[POST /fight]
        E[GET /events SSE]
        R[GET /repos]
    end

    subgraph Harness["⚔️ Fight harness"]
        O[fight.py orchestrator]
        A[fighter A\nsandbox + branch]
        B[fighter B\nsandbox + branch]
        REF[referee\nclean sandbox]
        SC[scoring.py\n60/25/15]
    end

    subgraph External
        TFY[TrueFoundry\nAI gateway]
        OAI[OpenAI]
        GH[GitHub\nthrowaway arena repo]
        QD[Qodo\nPR review]
        BD[Bright Data\nGitHub scrape]
    end

    UI -- click building --> F
    F -- spawn --> O
    O --> A & B --> REF --> SC
    O -- JSONL stdout --> E -- SSE --> BUS
    A & REF <--> TFY
    B <--> OAI
    A & B -- push branches --> GH
    REF -- open winner PR\ndelete loser branch --> GH
    GH --> QD
    BD -- repos.json --> R --> UI
```

### How one fight flows

```mermaid
sequenceDiagram
    participant U as User
    participant W as City (browser)
    participant S as Server
    participant H as Harness
    participant G as GitHub

    U->>W: click building, pick issue + 2 agents
    W->>S: POST /fight
    S->>H: spawn fight.py subprocess
    W->>S: EventSource /events
    H-->>W: fighter.started ×2 (walk in, hard hats on)
    loop each fighter, in parallel sandboxes
        H-->>W: tool.called (bubble over builder)
        H-->>W: commit.pushed (floor drops, squash & stretch)
        H-->>W: tests.result (windows pulse green/red)
    end
    H-->>W: fighter.done ×2
    H-->>W: referee.spawned (walks into arena)
    H-->>W: tests.result by=referee (re-runs MAIN's suite)
    H-->>W: referee.finding ×N (scorecard fills)
    H->>G: open winner PR, delete loser branch
    H-->>W: verdict + score breakdown
    Note over W: crane lowers crown · loser tower collapses ·<br/>winner floors fly onto the repo building
```

### How the referee decides

Shown live in the in-app **Referee's Scorecard** while it works:

| Component | Weight | Measured by |
|---|---|---|
| Original tests | 60% | MAIN's own suite re-run on each branch in a clean sandbox — editing tests in your branch does nothing |
| Code review | 25% | Findings on the diff (high −50%, medium −25%, low −10% of this component) |
| Diff economy | 15% | ≤40 changed lines = full marks, ≥400 = zero |

## The stack

| Piece | What it does |
|---|---|
| **Three.js city** | Procedural towers from live repo stats — height = stars, lit windows = commit activity, neon sign = language. Day and night themes. |
| **TrueFoundry AI gateway** | Runs the fighter and referee agent loops; every call, token, and cost visible in one dashboard. |
| **FastAPI + SSE** | `POST /fight` → subprocess harness → event stream. The server is a dumb pipe on purpose. |
| **Bright Data** | Scrapes the GitHub pages that seed and refresh the skyline — with a versioned scraper config and a heal log for when GitHub's markup shifts. |
| **Qodo** | Reviews every PR this repo merges, and the referee's PRs on the arena repo. |
| **Sandboxes** | Each fighter is jailed to its own shallow clone; path escapes are blocked at the tool layer. Fights run on a throwaway arena repo, never a real upstream. |

## Run it

```bash
pip install -r requirements.txt
uvicorn server.app:app --port 8000
# open http://localhost:8000  → click a building → START FIGHT
```

No API keys configured? START FIGHT still plays a full fight from a recorded
session, so the demo always runs. With keys in `harness/.env` (see
`harness/llm.py`) every fight is live: real sandboxes, real commits, real PR.

```bash
# fight from the terminal, no browser
python -m harness.fight --repo vercel/next.js \
  --task "slugify leaves trailing hyphens; make the suite pass" \
  --a sonnet --b gpt
```

## The event contract

Ten event types, one JSONL line each, from `session.opened` to
`session.closed`. The replay scrubber, the SSE stream, and the live harness
all speak exactly this schema — swap any of them and the city cannot tell
the difference. See `CLAUDE.md` for the full contract.

## What broke along the way

The honest log lives in [BLOG.md](BLOG.md) — including the Cloudflare 403
that only wanted a User-Agent, the shallow-clone fetch that never creates
`origin/<branch>`, and the referee correctly docking both fighters for
committing `__pycache__`.

## License

MIT. The city is procedural — no game assets, no AGPL code, nothing to buy.
