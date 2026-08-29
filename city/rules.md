# Bright Data scraper rules — Agent Fight City

Versioned config for `city/scrape.py` (Bright Data judging criterion). The API
token lives in `harness/.env` as `BRIGHTDATA_API_TOKEN` and is never committed
or logged.

## Product and zone

- **Product**: Web Unlocker, via the request API — `POST https://api.brightdata.com/request`
  with body `{"zone": "<zone>", "url": "<github page>", "format": "raw"}` and
  `Authorization: Bearer <token>`.
- **Zone**: discovered at run time from `GET https://api.brightdata.com/zone/get_active_zones`,
  preferring unlocker-type zones. Pin one explicitly with `BRIGHTDATA_ZONE=` in
  `harness/.env`. The zone actually used is stamped into `city/data/repos.json`'s
  `source` field for every run.
- **Transport**: python stdlib `urllib` + `certifi` (same pattern as
  `harness/llm.py`), custom `User-Agent: agent-fight-city/1.0` — Cloudflare in
  front of some endpoints rejects urllib's default UA.

## Targets and schema

For each of the 24 city repos (the same list as the seed `web/data/repos.json`),
up to three pages per repo:

| Page | Fields |
|---|---|
| `https://github.com/{owner}/{name}` | `stars`, `commits` |
| `https://github.com/{owner}/{name}/issues` | up to 3 `open_issues` (`number`, `title`) |
| `https://github.com/orgs/{owner}/repositories?q={name}` (404 → `https://github.com/{owner}?tab=repositories&q={name}`) | `language` |

The owner-listing page exists because GitHub's 2026 repo page renders the
Languages sidebar as a client-side skeleton — the language string is simply not
in the raw HTML any more (verified 2026-08-29). Org listing pages embed
per-repo `primaryLanguage` JSON; user profile pages still server-render
`itemprop="programmingLanguage"`.

Output schema is `city/schema.json`, identical to the seed file's shape:
`generated_at`, `source`, `repos[{full_name, language, stars, commits, open_issues[]}]`.

**Commits approximation**: GitHub does not put an exact all-branches commit
count on the page. We take whatever count is visible for the default branch
(the embedded `commitCount` / "N Commits" header), else `0`. This is an
approximation by design, not a bug.

## Parsing: fallback ladders

Every field is parsed with an ordered ladder of stdlib-`re` patterns — primary
tiers are today's GitHub markup (each verified against live pages on
2026-08-29), lower tiers cover older markup. First match wins and the matching
tier is recorded, so the heal log can name what broke:

- `language` (primary: `org-listing-json`, `profile-itemprop`): scoped
  `"name":"{name}","owner":"{owner}"` → `"primaryLanguage":{"name":...}` in the
  org listing's embedded JSON; scoped `itemprop="programmingLanguage"` on user
  profiles → unscoped variants → legacy repo-page sidebar/`search?l=` markup.
- `stars` (primary: `stars-counter-title`): `repo-stars-counter-star` title
  attr → `aria-label="N users starred"` → embedded `stargazerCount` → classic
  `social-count`.
- `commits` (primary: `embedded-commitCount`): embedded `commitCount` →
  `<strong>N</strong> Commits` → plain "N Commits" text.
- `open_issues` (primary: `relay-titleHtml`): 2026 Relay JSON nodes
  (`"number":N … "titleHtml":"…"`) → embedded JSON with plain `"title"` in
  either key order → classic `/issues/N` anchor rows. Titles are
  JSON-unescaped, HTML-entity-decoded, and tag-stripped.

## Validation and heal path

Every scraped row is validated in plain python against the rules mirrored in
`city/schema.json`. A row that fails validation falls back to its freshest
known-good row (previous run's output, else the seed entry from
`web/data/repos.json`) — the city never loses buildings. If any field is
missing for **more than half** of the scraped repos, that means the page markup
changed: a timestamped entry is appended to the Heal log below saying what
broke and which fallback tier (if any) healed it.

## Politeness

- Hard budget of **30 requests per run** (zone discovery included) — covers
  ~9 repos at ~3 pages each. A rotation cursor in
  `city/data/scrape_state.json` makes each run of the 30-minute loop continue
  where the previous one stopped, so the whole skyline refreshes over ~3 runs;
  repos not reached this run keep their previous rows.
- 1.2s sleep between requests, 60s timeout per request.
- Partial results are always kept.

## Heal log
- **2026-08-29 21:35 UTC** — run aborted before scraping: Bright Data API rejected the token (HTTP 401 from /zone/get_active_zones: Token expired). Wrote full seed fallback for all 24 repos; no page was fetched.
- **2026-08-29 21:41 UTC** — run aborted before scraping: Bright Data API rejected the token (HTTP 401 from /zone/get_active_zones: Token expired). Wrote previous/seed fallback for all 24 repos.
- **2026-08-29 22:41 UTC** — `language` missing for 9/9 scraped repos (zone `mcp_unlocker`) — GitHub markup likely changed; every fallback pattern tier in scrape.py was tried. Affected rows fell back to their previous/seed entries.
