# Agent Fight City — build log

What broke and what we changed, one line each, newest last.

- Click-to-pick silently dead: the click handler reused `ndc` from the last pointermove, which synthetic clicks never fire; compute ndc in the handler itself.
- git-city (reference repo) is AGPL with paid non-redistributable assets: took the window-atlas *technique*, wrote our own renderer, copied zero code.
- Test-result pulses stacked: each pulse saved the *current* emissive as "original", so overlapping pulses baked red into towers permanently; store the true original once.
- Fight-end error cascade: `close()` nulls `arena.group` while dust/merge tweens still reference `this.group`; capture the group per closure.
- Camera choreography kept diving inside neighbor towers; raised every shot and shrank the work orbit to street level inside the arena block.
- TrueFoundry gateway 403 "error code: 1010": Cloudflare rejects the default urllib User-Agent; any custom UA fixes it.
- Gateway exposes exactly one model (openai/gpt-4.1) — no Anthropic provider configured yet, so fighter A runs gateway GPT-4.1 and fighter B runs direct OpenAI until one is added.
- macOS python 3.14 urllib had no CA bundle (CERTIFICATE_VERIFY_FAILED); certifi context everywhere.
- Frontend POSTs /fight before opening the EventSource, so the SSE stream replays session history first or the browser misses session.opened.
- Referee crashed post-fight: bare `git fetch origin <branch>` on a shallow clone never creates origin/<branch>, only FETCH_HEAD; fetch with an explicit refspec.
- Fighters committed __pycache__ and the referee docked them for it; commit_all now excludes bytecode.
