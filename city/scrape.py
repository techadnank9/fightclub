"""Bright Data city builder.

`python3 -m city.scrape` scrapes each city repo's GitHub pages *through the
Bright Data Web Unlocker request API* (never the GitHub API — the Bright Data
pipeline is the point) and writes `city/data/repos.json` in exactly the schema
of the seed file `web/data/repos.json` (see `city/schema.json`).

Pipeline per run:
  1. Zone discovery: GET https://api.brightdata.com/zone/get_active_zones,
     pick an unlocker-type zone (override with BRIGHTDATA_ZONE in harness/.env).
  2. For each repo (budget permitting): POST https://api.brightdata.com/request
     {"zone": ..., "url": "<page>", "format": "raw"} for three pages:
       - https://github.com/<owner>/<name>            -> stars, commits
       - https://github.com/<owner>/<name>/issues     -> up to 3 open issues
       - the owner's repositories listing             -> language
     The listing page is needed because GitHub's 2026 repo page renders the
     Languages sidebar as a client-side skeleton (no language in the raw
     HTML); org listing pages embed `primaryLanguage` JSON and user profile
     pages still server-render `itemprop="programmingLanguage"`.
  3. Parse with stdlib `re` only — every field has an ordered ladder of
     patterns (verified against live 2026 GitHub markup, with older-markup
     fallbacks), so one markup change degrades, never zeroes.
  4. Validate every row against the rules in city/schema.json (plain python,
     no jsonschema dep). A row that fails validation falls back to its
     previous/seed entry so the city never loses buildings.
  5. Heal path: if a field came back missing for more than half the scraped
     repos, the markup changed — a timestamped entry is appended to the
     "Heal log" section of city/rules.md saying what broke and which fallback
     tier (if any) rescued it.

Politeness: hard budget of 30 requests per run (~9 repos at ~3 pages each),
~1.2s sleep between requests, 60s timeout each. A rotation cursor persisted
in city/data/scrape_state.json makes successive runs (the 30-min loop) pick
up where the last one stopped, so the whole skyline refreshes over a few
runs; repos not reached this run keep their previous row.

Commits approximation: GitHub's repo page embeds a default-branch commit
count ("commitCount" / "N Commits"); we use whatever count is visible, else
0. Documented in city/rules.md.

The Bright Data API token lives in harness/.env as BRIGHTDATA_API_TOKEN and
is NEVER printed or written to any file by this module.
"""

from __future__ import annotations

import html as html_mod
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import certifi

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = ROOT / "web" / "data" / "repos.json"
OUT_PATH = ROOT / "city" / "data" / "repos.json"
STATE_PATH = ROOT / "city" / "data" / "scrape_state.json"
RULES_PATH = ROOT / "city" / "rules.md"
ENV_PATH = ROOT / "harness" / ".env"

API_BASE = "https://api.brightdata.com"
_UA = "agent-fight-city/1.0"  # Cloudflare rejects default urllib UA (see harness/llm.py)
_CTX = ssl.create_default_context(cafile=certifi.where())

MAX_REQUESTS = 30          # politeness budget per run
SLEEP_BETWEEN = 1.2        # seconds between Bright Data requests
REQUEST_TIMEOUT = 60       # per-request timeout, seconds
MAX_ISSUES = 3
WORST_CASE_PER_REPO = 4    # repo + issues + org listing 404 + user listing

# Same 24 repos as the seed file web/data/repos.json — the city skyline.
REPOS = [
    "vercel/next.js", "facebook/react", "rust-lang/rust", "python/cpython",
    "torvalds/linux", "golang/go", "microsoft/vscode", "sveltejs/svelte",
    "denoland/deno", "pytorch/pytorch", "tailwindlabs/tailwindcss",
    "nodejs/node", "kubernetes/kubernetes", "rails/rails", "django/django",
    "flutter/flutter", "ziglang/zig", "BurntSushi/ripgrep",
    "expressjs/express", "vitejs/vite", "postgres/postgres", "redis/redis",
    "ollama/ollama", "ggerganov/llama.cpp",
]


def load_env() -> dict:
    env: dict = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    import os
    for k, v in os.environ.items():
        env.setdefault(k, v)
    return env


# --------------------------------------------------------------------------
# Bright Data transport
# --------------------------------------------------------------------------

class BrightDataAuthError(RuntimeError):
    """The API rejected our token (401/403) — nothing can be scraped."""


class PageNotFound(RuntimeError):
    """Target page 404'd (e.g. org-listing URL for a user owner)."""


def _api(token: str, path: str, payload: dict | None = None) -> tuple[int, str]:
    data = None
    headers = {"Authorization": f"Bearer {token}", "User-Agent": _UA}
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API_BASE + path, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT, context=_CTX) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:500]
    except Exception as e:  # DNS, timeout, reset
        return -1, repr(e)


def discover_zone(token: str, env: dict) -> str:
    """Pick the Web Unlocker zone to use. BRIGHTDATA_ZONE in .env wins."""
    override = env.get("BRIGHTDATA_ZONE")
    if override:
        return override
    status, body = _api(token, "/zone/get_active_zones")
    if status in (401, 403):
        raise BrightDataAuthError(f"HTTP {status} from /zone/get_active_zones: {body[:200]}")
    if status != 200:
        raise RuntimeError(f"zone discovery failed: HTTP {status}: {body[:200]}")
    zones = json.loads(body)
    # Prefer unlocker-type zones, then serp, then anything.
    for want in ("unblocker", "unlocker", "serp"):
        for z in zones:
            zid = (z.get("type") or "") + " " + (z.get("name") or "")
            if want in zid.lower():
                return z["name"]
    if zones:
        return zones[0]["name"]
    raise RuntimeError("no active zones on this Bright Data account")


def unlocker_fetch(token: str, zone: str, url: str) -> str:
    """One page through the Web Unlocker request API. Returns raw HTML."""
    status, body = _api(token, "/request", {"zone": zone, "url": url, "format": "raw"})
    if status in (401, 403):
        raise BrightDataAuthError(f"HTTP {status} fetching {url}: {body[:200]}")
    if status == 404:
        raise PageNotFound(url)
    if status != 200:
        raise RuntimeError(f"HTTP {status} fetching {url}: {body[:200]}")
    return body


# --------------------------------------------------------------------------
# HTML parsing — stdlib re only, ordered fallback ladders per field
# --------------------------------------------------------------------------
# Each ladder is a list of (tier_name, regex). First match wins; the tier
# that matched is recorded so the heal log can say which markup broke.
# Tiers marked in PRIMARY_TIERS are today's verified markup; matching a
# non-primary tier means the primary broke and a fallback healed it.

LANG_PATTERNS = [
    # Historical repo-page markups, kept as free extra tiers (the 2026 repo
    # page no longer contains the language at all — see module docstring).
    ("repo-sidebar-lang-bar", re.compile(
        r'class="color-fg-default text-bold mr-1">\s*([^<>]{1,40}?)\s*</span>\s*<span>[\d.]+%')),
    ("repo-search-l-href", re.compile(
        r'href="/[^"]+/search\?l=[^"]+"[^>]*>\s*(?:<span[^>]*>)?\s*([^<>]{1,40}?)\s*</span>')),
]

STAR_PATTERNS = [
    ("stars-counter-title", re.compile(r'id="repo-stars-counter-star"[^>]*title="([\d,]+)"')),
    ("aria-users-starred", re.compile(r'aria-label="([\d,]+)\s+users?\s+starred')),
    ("embedded-stargazerCount", re.compile(r'"stargazerCount"\s*:\s*(\d+)')),
    ("social-count", re.compile(r'class="social-count[^"]*"[^>]*>\s*([\d,]+)\s*<', re.I)),
]

COMMIT_PATTERNS = [
    ("embedded-commitCount", re.compile(r'"commitCount"\s*:\s*"?([\d,]+)"?')),
    ("strong-commits", re.compile(r'<strong>\s*([\d,]+)\s*</strong>\s*(?:<[^>]+>\s*)*[Cc]ommits')),
    ("plain-commits-text", re.compile(r'([\d,]+)\s+[Cc]ommits\b')),
]

# Issues page: the 2026 UI ships issue rows inside embedded Relay JSON with
# "number" ... "titleHtml" per node; older UIs are covered by lower tiers.
ISSUE_TITLEHTML = re.compile(r'"titleHtml"\s*:\s*"((?:[^"\\]|\\.)*)"')
ISSUE_NUMBER_BACK = re.compile(r'"number"\s*:\s*(\d+)')
ISSUE_JSON_NT = re.compile(r'"number"\s*:\s*(\d+)\s*,\s*"title"\s*:\s*"((?:[^"\\]|\\.)+)"')
ISSUE_JSON_TN = re.compile(r'"title"\s*:\s*"((?:[^"\\]|\\.)+)"\s*,\s*"number"\s*:\s*(\d+)')

PRIMARY_TIERS = {
    "language": {"org-listing-json", "profile-itemprop"},
    "stars": {"stars-counter-title"},
    "commits": {"embedded-commitCount"},
    "open_issues": {"relay-titleHtml"},
}


def _to_int(s: str) -> int:
    return int(s.replace(",", ""))


def _first_match(patterns, text: str) -> tuple[str | None, str | None]:
    """Returns (value, tier_name) from the first pattern that matches."""
    for tier, rx in patterns:
        m = rx.search(text)
        if m:
            return m.group(1), tier
    return None, None


def parse_repo_page(html: str) -> tuple[dict, dict]:
    """Extract stars/commits (and language if old markup shows it)."""
    fields: dict = {}
    tiers: dict = {}

    lang, tier = _first_match(LANG_PATTERNS, html)
    if lang:
        fields["language"], tiers["language"] = lang.strip(), tier

    stars, tier = _first_match(STAR_PATTERNS, html)
    if stars:
        try:
            fields["stars"], tiers["stars"] = _to_int(stars), tier
        except ValueError:
            pass

    commits, tier = _first_match(COMMIT_PATTERNS, html)
    if commits:
        try:
            fields["commits"], tiers["commits"] = _to_int(commits), tier
        except ValueError:
            pass
    # commits is an approximation by design: 0 when nothing visible.

    return fields, tiers


def parse_owner_listing(html: str, owner: str, name: str) -> tuple[str | None, str | None]:
    """Language from an owner repositories listing page.

    Org pages (/orgs/<o>/repositories) embed per-repo JSON with
    `primaryLanguage`; user profile pages (?tab=repositories) still
    server-render `itemprop="programmingLanguage"`. Both scoped to our exact
    repo, with unscoped variants as last-resort tiers.
    """
    # Tier: org embedded JSON, scoped to this repo's entry.
    m = re.search(r'"name"\s*:\s*"%s"\s*,\s*"owner"\s*:\s*"%s"'
                  % (re.escape(name), re.escape(owner)), html)
    if m:
        window = html[m.end():m.end() + 3000]
        lm = re.search(r'"primaryLanguage"\s*:\s*\{\s*"name"\s*:\s*"([^"]{1,40})"', window)
        if lm:
            return lm.group(1), "org-listing-json"
    # Tier: user profile markup, scoped near the repo link.
    m = re.search(r'href="/%s/%s"' % (re.escape(owner), re.escape(name)), html)
    if m:
        window = html[m.start():m.start() + 4000]
        lm = re.search(r'itemprop="programmingLanguage"[^>]*>\s*([^<>]{1,40}?)\s*<', window)
        if lm:
            return lm.group(1), "profile-itemprop"
    # Unscoped fallbacks (single-result filtered listings).
    lm = re.search(r'"primaryLanguage"\s*:\s*\{\s*"name"\s*:\s*"([^"]{1,40})"', html)
    if lm:
        return lm.group(1), "org-listing-json-unscoped"
    lm = re.search(r'itemprop="programmingLanguage"[^>]*>\s*([^<>]{1,40}?)\s*<', html)
    if lm:
        return lm.group(1), "profile-itemprop-unscoped"
    return None, None


def _clean_title(raw: str) -> str:
    try:
        s = json.loads(f'"{raw}"')  # decode \uXXXX and \" escapes
    except Exception:
        s = raw
    s = html_mod.unescape(s)
    s = re.sub(r"<[^>]+>", "", s)
    return s.strip()[:300]


def parse_issues_page(html: str, full_name: str) -> tuple[list, str | None]:
    """Extract up to MAX_ISSUES open issues. Returns (issues, tier_used)."""
    found: list[tuple[int, str]] = []

    def _add(num: int, title: str):
        if title and num >= 1 and not any(n == num for n, _ in found):
            found.append((num, title))

    # Tier 1 (2026 Relay JSON): each issue node carries "number" then, a few
    # hundred chars later (past the repository sub-object), "titleHtml".
    for m in ISSUE_TITLEHTML.finditer(html):
        back = html[max(0, m.start() - 900):m.start()]
        nums = ISSUE_NUMBER_BACK.findall(back)
        if nums:
            _add(int(nums[-1]), _clean_title(m.group(1)))
    tier = "relay-titleHtml" if found else None

    # Tier 2: embedded JSON with plain "title", either key order.
    if not found:
        for m in ISSUE_JSON_NT.finditer(html):
            _add(int(m.group(1)), _clean_title(m.group(2)))
        for m in ISSUE_JSON_TN.finditer(html):
            _add(int(m.group(2)), _clean_title(m.group(1)))
        tier = "embedded-json-title" if found else None

    # Tier 3: classic anchor markup.
    if not found:
        owner, name = full_name.split("/", 1)
        rx = re.compile(
            r'href="/%s/%s/issues/(\d+)"[^>]*>\s*([^<>]{3,300}?)\s*</a>'
            % (re.escape(owner), re.escape(name)))
        for m in rx.finditer(html):
            _add(int(m.group(1)), _clean_title(m.group(2)))
        tier = "anchor-markup" if found else None

    return [{"number": n, "title": t} for n, t in found[:MAX_ISSUES]], tier


# --------------------------------------------------------------------------
# Validation — plain python mirroring city/schema.json
# --------------------------------------------------------------------------

_FULL_NAME_RX = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


def validate_repo_row(row: dict) -> list[str]:
    """Returns a list of violations (empty == valid). Mirrors schema.json."""
    errs = []
    if not isinstance(row.get("full_name"), str) or not _FULL_NAME_RX.match(row.get("full_name", "")):
        errs.append("full_name: must match owner/name")
    lang = row.get("language")
    if not isinstance(lang, str) or not (1 <= len(lang) <= 40):
        errs.append("language: non-empty string <=40 chars required")
    stars = row.get("stars")
    if not isinstance(stars, int) or isinstance(stars, bool) or stars < 0:
        errs.append("stars: integer >= 0 required")
    commits = row.get("commits")
    if not isinstance(commits, int) or isinstance(commits, bool) or commits < 0:
        errs.append("commits: integer >= 0 required")
    issues = row.get("open_issues")
    if not isinstance(issues, list) or len(issues) > MAX_ISSUES:
        errs.append(f"open_issues: list of <={MAX_ISSUES} required")
    else:
        for i, it in enumerate(issues):
            if not isinstance(it, dict):
                errs.append(f"open_issues[{i}]: object required")
                continue
            n = it.get("number")
            if not isinstance(n, int) or isinstance(n, bool) or n < 1:
                errs.append(f"open_issues[{i}].number: integer >= 1 required")
            t = it.get("title")
            if not isinstance(t, str) or not (1 <= len(t) <= 300):
                errs.append(f"open_issues[{i}].title: non-empty string <=300 chars required")
    return errs


# --------------------------------------------------------------------------
# Heal log
# --------------------------------------------------------------------------

def append_heal_log(lines: list[str]) -> None:
    """Append timestamped entries under the '## Heal log' section of rules.md."""
    if not lines:
        return
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    entry = "\n".join(f"- **{ts}** — {line}" for line in lines) + "\n"
    text = RULES_PATH.read_text() if RULES_PATH.exists() else "# Bright Data scraper rules\n"
    if "## Heal log" not in text:
        text = text.rstrip() + "\n\n## Heal log\n\n"
    text = text.rstrip() + "\n" + entry
    RULES_PATH.write_text(text)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def load_fallback_rows() -> dict:
    """Seed rows overlaid with the previous run's output — the freshest
    known-good row per repo, so a failed scrape never loses a building."""
    seed = json.loads(SEED_PATH.read_text())
    rows = {r["full_name"]: r for r in seed["repos"]}
    if OUT_PATH.exists():
        try:
            prev = json.loads(OUT_PATH.read_text())
            for r in prev.get("repos", []):
                if not validate_repo_row(r):
                    rows[r["full_name"]] = r
        except Exception:
            pass
    return rows


def _load_cursor() -> int:
    try:
        return int(json.loads(STATE_PATH.read_text()).get("cursor", 0)) % len(REPOS)
    except Exception:
        return 0


def _save_cursor(cursor: int) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(
        {"cursor": cursor % len(REPOS),
         "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}) + "\n")


def scrape_one(token: str, zone: str, full_name: str, spend) -> tuple[dict, dict, str | None]:
    """Scrape one repo (2-4 requests). Returns (row, tiers, issues_tier)."""
    owner, name = full_name.split("/", 1)
    row = {"full_name": full_name, "language": None, "stars": None,
           "commits": 0, "open_issues": []}
    tiers: dict = {}
    issues_tier = None

    # Page 1: repo home -> stars, commits (language only on legacy markup).
    html = spend(lambda: unlocker_fetch(token, zone, f"https://github.com/{full_name}"))
    fields, t = parse_repo_page(html)
    row.update(fields)
    tiers.update(t)

    # Page 2: issues -> up to 3 open issue titles+numbers.
    ihtml = spend(lambda: unlocker_fetch(
        token, zone, f"https://github.com/{full_name}/issues"))
    issues, issues_tier = parse_issues_page(ihtml, full_name)
    row["open_issues"] = issues

    # Page 3 (only if still needed): owner listing -> language.
    if not row.get("language"):
        q = urllib.parse.quote(name)
        lhtml = None
        try:
            lhtml = spend(lambda: unlocker_fetch(
                token, zone, f"https://github.com/orgs/{owner}/repositories?q={q}"))
        except PageNotFound:
            lhtml = spend(lambda: unlocker_fetch(
                token, zone, f"https://github.com/{owner}?tab=repositories&q={q}"))
        if lhtml:
            lang, t = parse_owner_listing(lhtml, owner, name)
            if lang:
                row["language"], tiers["language"] = lang, t

    return row, tiers, issues_tier


def main(argv: list[str]) -> int:
    env = load_env()
    token = env.get("BRIGHTDATA_API_TOKEN", "")
    fallback_rows = load_fallback_rows()
    heal_lines: list[str] = []
    rows_by_name: dict = {}
    scraped_clean = 0
    fallbacks = 0
    requests_used = 0
    attempted = 0
    field_hits = {k: 0 for k in PRIMARY_TIERS}
    fallback_tiers_seen: dict[str, set] = {k: set() for k in PRIMARY_TIERS}
    zone = None
    source = None
    cursor = _load_cursor()
    new_cursor = cursor

    class Budget(Exception):
        pass

    def spend(fn):
        nonlocal requests_used
        if requests_used >= MAX_REQUESTS:
            raise Budget()
        requests_used += 1
        try:
            return fn()
        finally:
            time.sleep(SLEEP_BETWEEN)

    try:
        if not token:
            raise BrightDataAuthError("BRIGHTDATA_API_TOKEN missing from harness/.env")
        zone = discover_zone(token, env)
        requests_used += 1  # zone discovery counts against the budget
        print(f"[city.scrape] using Bright Data Web Unlocker zone: {zone}; "
              f"starting at repo #{cursor} ({REPOS[cursor]})")
        source = (f"brightdata web-unlocker zone={zone} "
                  f"(github.com pages, not the API)")

        order = REPOS[cursor:] + REPOS[:cursor]
        for i, full_name in enumerate(order):
            if MAX_REQUESTS - requests_used < WORST_CASE_PER_REPO:
                print(f"[city.scrape] request budget reached; remaining repos "
                      f"keep their previous rows this run")
                break
            attempted += 1
            new_cursor = (cursor + i + 1) % len(REPOS)
            row = None
            try:
                row, tiers, issues_tier = scrape_one(token, zone, full_name, spend)
                for f, t in tiers.items():
                    field_hits[f] += 1
                    if t not in PRIMARY_TIERS[f]:
                        fallback_tiers_seen[f].add(t)
                if row["open_issues"]:
                    field_hits["open_issues"] += 1
                    if issues_tier not in PRIMARY_TIERS["open_issues"]:
                        fallback_tiers_seen["open_issues"].add(issues_tier)
            except BrightDataAuthError:
                raise
            except Budget:
                attempted -= 1
                new_cursor = (cursor + i) % len(REPOS)
                break
            except Exception as e:
                print(f"[city.scrape] {full_name}: fetch failed: {e}", file=sys.stderr)

            errs = validate_repo_row(row) if row else ["fetch failed"]
            if errs:
                fallbacks += 1
                print(f"[city.scrape] {full_name}: {'; '.join(errs)} -> fallback row")
                rows_by_name[full_name] = fallback_rows[full_name]
            else:
                scraped_clean += 1
                rows_by_name[full_name] = row
                print(f"[city.scrape] {full_name}: ok — {row['language']}, "
                      f"{row['stars']} stars, {row['commits']} commits, "
                      f"{len(row['open_issues'])} issues")

        # Heal detection: a field missing for more than half the scraped repos
        # means the page markup changed under us.
        if attempted:
            for f, hits in field_hits.items():
                if hits * 2 < attempted:
                    heal_lines.append(
                        f"`{f}` missing for {attempted - hits}/{attempted} scraped repos "
                        f"(zone `{zone}`) — GitHub markup likely changed; every fallback "
                        f"pattern tier in scrape.py was tried. Affected rows fell back to "
                        f"their previous/seed entries.")
                elif fallback_tiers_seen[f]:
                    tiers_s = ", ".join(sorted(t or "?" for t in fallback_tiers_seen[f]))
                    heal_lines.append(
                        f"`{f}` primary pattern missed on some pages; healed by fallback "
                        f"tier(s): {tiers_s}.")

    except BrightDataAuthError as e:
        # Token rejected: the whole city keeps its previous rows.
        print(f"[city.scrape] Bright Data auth failed: {e}", file=sys.stderr)
        print("[city.scrape] writing fallback rows for every repo — refresh the "
              "BRIGHTDATA_API_TOKEN in harness/.env and re-run", file=sys.stderr)
        heal_lines.append(
            f"run aborted before scraping: Bright Data API rejected the token "
            f"({e}). Wrote previous/seed fallback for all {len(REPOS)} repos.")
        rows_by_name = {}
        fallbacks = len(REPOS)
        attempted = 0
        source = "seed fallback (Bright Data token rejected; see city/rules.md heal log)"
        new_cursor = cursor

    # Repos not scraped this run keep their freshest known-good row.
    rows = [rows_by_name.get(n, fallback_rows[n]) for n in REPOS]

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source or "seed fallback",
        "repos": rows,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2) + "\n")
    _save_cursor(new_cursor)
    append_heal_log(heal_lines)

    print(f"[city.scrape] wrote {OUT_PATH} — {scraped_clean} scraped clean, "
          f"{fallbacks} fallback rows, {len(rows)} rows total, "
          f"{requests_used}/{MAX_REQUESTS} requests used, next cursor {new_cursor}")
    if heal_lines:
        print(f"[city.scrape] {len(heal_lines)} heal-log entr"
              f"{'y' if len(heal_lines) == 1 else 'ies'} appended to city/rules.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
