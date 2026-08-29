# Agent Fight City — build brief

Hackathon project. One day. Read this whole file before writing code.

## What we are building

A 3D pixel-art city where every building is a GitHub repo. The user clicks a building, picks a pending issue (or types a task) and two AI agents. Each agent works the task in its own isolated sandbox on its own branch. A referee agent (backed by Qodo review) runs tests on both, scores them, opens the winner's PR, and deletes the loser's branch. The 3D frontend renders all of this live as characters building towers next to the repo building.

The harness (TrueForge) runs the agents. The frontend is only a renderer of harness events. Bright Data scrapes GitHub to seed and refresh the city.

## Non-negotiables

- Frontend first, driven by the mock event feed. The backend later replaces the mock with real events using the exact same schema.
- The frontend never contains fight logic. It consumes events and animates. The mock is a stand-in for the harness, not a game engine.
- Every PR goes through Qodo before merge. Fix what it flags.
- Commit small and often. Conventional commits.
- Don't add dependencies without a reason written in the commit.

## Repo layout

```
agent-fight-city/
  CLAUDE.md                 # this file
  harness/                  # TrueForge agent definitions + orchestrator
    fight.py                # entry: python -m harness.fight --repo owner/name --task "..." --a sonnet --b gpt
    agents/
      fighter.md            # fighter system prompt
      referee.md            # referee system prompt
    tools/                  # MCP config, GitHub tool wrappers
    events.py               # event schema + emitter (stdout JSONL + SSE)
    scoring.py              # mechanical score from test results + Qodo findings
  city/                     # Bright Data city builder
    scrape.py               # bdata / MCP calls, writes city/data/repos.json
    schema.json             # repo row schema
    rules.md                # Bright Data scraper config, versioned (Bright Data judging criterion)
  server/
    app.py                  # FastAPI: POST /fight, GET /events (SSE), GET /repos
  web/
    index.html              # the Three.js prototype (already exists, copy it in)
  tests/
  README.md
  BLOG.md                   # notes as we go: what broke, what we changed
```

## Event schema (contract between backend and frontend)

Backend emits JSON lines. Frontend calls `window.FightCity.dispatch(event)` for each.

```json
{"type":"session.opened","session":"fight-8a3f","repo":"vercel/next.js","task":"..."}
{"type":"fighter.started","side":"a","agent":"sonnet","sandbox":"sb-a-8a3f","branch":"fight/a-8a3f"}
{"type":"tool.called","side":"a","tool":"edit routes.ts"}
{"type":"commit.pushed","side":"a","sha":"abc123","msg":"add limiter"}
{"type":"tests.result","side":"a","ok":true,"passed":12,"total":12}
{"type":"fighter.done","side":"a"}
{"type":"referee.spawned","sandbox":"sb-ref-8a3f"}
{"type":"referee.finding","side":"b","severity":"medium","msg":"2 tests weakened"}
{"type":"verdict","winner":"a","score":{"a":84,"b":61},"pr":4821,"deleted":"fight/b-8a3f"}
{"type":"session.closed"}
```

Sides are always `a` and `b`. Frontend already handles every type above except `session.*`; add those.

## Phases with acceptance criteria

### Phase 1 — frontend: the fight looks amazing on mock events (target: before lunch)
Start from `web/index.html` (existing Three.js prototype, single file, r128 from CDN). Keep it a single file until it passes 1200 lines, then split into modules with Vite.

Build in this order, each visible in the browser before moving on:
1. **Characters**: replace procedural voxel people with rigged GLB models (Kenney Mini Characters or Quaternius, free). Clips needed: idle, walk, work/hammer, cheer. Referee gets a hard hat and a Qodo badge. Fighter colour comes from the agent, applied to the model's material.
2. **Camera choreography**: cinematic moves on `session.opened` (swoop to lot), during work (slow orbit), `referee.spawned` (cut to referee walking in), `verdict` (pull back wide). Smooth easing, no snapping. User drag interrupts auto camera; it resumes on next event.
3. **Tower animation**: floor drop with squash-and-stretch, window glow pulse on `tests.result`, dust particles + camera shake on collapse, crane or beam lowering the crown on win, winner's floors flying onto the repo building on merge.
4. **HUD**: fight card shows each fighter's current tool call, commit count, test bar; harness panel shows sandbox states; verdict overlay. Make the "what is it doing / waiting on / did" states obvious (Best UI criterion).
5. **City**: buildings from `web/data/repos.json` (same schema as the Bright Data scrape will produce). Hover highlights, label on select, slow ambient orbit when idle.
6. **Replay**: store the event log of each fight; a scrubber at the bottom replays it. This is the "4D" feature.

Mock feed stays in `web/mock.js`, emits only the documented event types with realistic timing. Add a `?mock=1` query flag so mock and real backend can coexist.

Done when: a stranger can click a building, pick a task and two agents, watch a full fight to verdict, and replay it — with no backend running.

### Phase 2 — server + event stream (target: early afternoon)
- FastAPI: `POST /fight {repo, task, a, b}` returns session id. `GET /events?session=` streams SSE. `GET /repos` serves `city/data/repos.json`.
- Frontend: without `?mock=1`, Start Fight POSTs to `/fight` and an EventSource dispatches each event. Zero changes to animation code — if you need to change animation code here, the event schema was wrong; fix the schema instead.
- Done when: the server replays a saved JSONL event log and the frontend animates identically to mock.

### Phase 3 — harness: real fighters and referee (target: mid afternoon)
- TrueForge: fighter A and B as subagents in separate sandboxes, same task, branches `fight/a-<id>` and `fight/b-<id>`. A on Anthropic, B on OpenAI.
- Referee subagent in a clean fourth sandbox: runs the ORIGINAL test suite from `main` on each branch (never the fighter's modified tests), calls Qodo review on each diff, findings become `referee.finding` events.
- `scoring.py`: pass rate on original tests (60%) + Qodo severity penalty (25%) + diff size penalty (15%). Formula goes in the PR body.
- Referee opens winner's PR, deletes loser's branch, emits `verdict`.
- Use a throwaway test repo we own. Never fight on real upstream repos.
- Done when: clicking Start Fight in the browser produces a real PR on GitHub and the city animates from real events.

### Phase 4 — Bright Data city (target: late afternoon)
- `city/scrape.py` uses the Bright Data CLI (`bdata scraper create/run`) or MCP to pull per repo: name, language, stars, commit count, open issues (title, number) from the GitHub repo and issues pages. Not the GitHub API — the point is the Bright Data pipeline.
- Config in `city/rules.md`: Collector ID, schema, heal log. Committed.
- Validate against `city/schema.json`; on nulls, `bdata scraper heal <id> "<what broke>"`, re-run, log it.
- Loop re-scrapes every 30 min; skyline updates.
- Done when: `python -m city.scrape` writes `repos.json` and the heal path has run once against a changed page.

### Phase 5 — only if 1–4 are green
Sound, more particles, multiple simultaneous fights in the city, blog screenshots.

## Sponsor checklist

- TrueForge: subagents, per-agent sandboxes, sessions, MCP. Take a screenshot of its dashboard mid-fight for the blog.
- Qodo: referee uses it programmatically; our own PRs also go through it. Keep the review comments in the PR history.
- Bright Data: CLI in terminal, config in `city/rules.md`, heal demonstrated, data feeds the city.
- OpenAI: fighter B runs on GPT.

## Working style with me

- Before starting a phase, restate the acceptance criteria and list the files you'll touch.
- After each phase, run the done-when check and show me the output.
- If TrueForge can't do something this brief assumes (e.g. per-subagent MCP scoping), stop and tell me instead of working around it silently.
- Append to `BLOG.md` whenever something breaks and you fix it. One line each.
