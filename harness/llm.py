"""LLM access.

Two providers, both OpenAI-compatible chat completions:
- "tfy": the TrueFoundry AI gateway on the user's control plane. This is the
  harness's primary brain — sessions, metrics, and cost tracking all show up
  in the TrueFoundry dashboard.
- "openai": direct OpenAI, used for fighter B so the two fighters genuinely
  run on different providers.

Uses urllib (stdlib) + certifi so there are no SDK dependencies to install.
The gateway sits behind Cloudflare which rejects the default urllib UA, so a
custom User-Agent is mandatory (found the hard way; see BLOG.md).
"""

from __future__ import annotations

import json
import os
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path

import certifi

_CTX = ssl.create_default_context(cafile=certifi.where())
_UA = "agent-fight-city/1.0"


def load_env() -> dict:
    """Read harness/.env (gitignored) merged over os.environ."""
    env = dict(os.environ)
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip())
    return env


ENV = load_env()

# Fighter name (as shown in the UI) -> (provider, model). The gateway
# currently exposes only openai/gpt-4.1; when an Anthropic provider is added
# to the TrueFoundry gateway, point the claude names at it here.
AGENTS = {
    "sonnet": ("tfy", ENV.get("TFY_MODEL", "openai/gpt-4.1")),
    "opus": ("tfy", ENV.get("TFY_MODEL", "openai/gpt-4.1")),
    "haiku": ("tfy", ENV.get("TFY_MODEL", "openai/gpt-4.1")),
    "gpt": ("openai", "gpt-4.1"),
    "gpt-mini": ("openai", "gpt-4o-mini"),
    "referee": ("tfy", ENV.get("TFY_MODEL", "openai/gpt-4.1")),
}


def chat(agent: str, messages: list, tools: list | None = None,
         max_tokens: int = 1500, retries: int = 3) -> dict:
    """One chat-completions call. Returns the first choice's message dict."""
    provider, model = AGENTS[agent]
    if provider == "tfy":
        url = ENV["TFY_BASE_URL"].rstrip("/") + "/chat/completions"
        key = ENV["TFY_API_KEY"]
    else:
        url = "https://api.openai.com/v1/chat/completions"
        key = ENV["OPENAI_API_KEY"]

    body: dict = {"model": model, "messages": messages, "max_tokens": max_tokens}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"

    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "User-Agent": _UA,
    })
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120, context=_CTX) as r:
                payload = json.load(r)
            return payload["choices"][0]["message"]
        except urllib.error.HTTPError as e:
            detail = e.read()[:300]
            last_err = RuntimeError(f"{provider} {e.code}: {detail!r}")
            if e.code in (429, 500, 502, 503):
                time.sleep(2 * (attempt + 1))
                continue
            raise last_err from None
        except Exception as e:  # timeouts, resets
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"chat failed after {retries} tries: {last_err}")
