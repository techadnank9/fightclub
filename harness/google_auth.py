"""One-time Google OAuth bootstrap for Vertex AI.

  python3 -m harness.google_auth

Prints a consent URL. The user opens it, signs in, approves; Google redirects
to localhost where this script catches the code, exchanges it, and appends
GOOGLE_REFRESH_TOKEN to harness/.env. After that the harness mints access
tokens on its own — no more browser.

Uses only stdlib + certifi (same as everything else in the harness).
"""

from __future__ import annotations

import http.server
import json
import ssl
import threading
import urllib.parse
import urllib.request
from pathlib import Path

import certifi

_CTX = ssl.create_default_context(cafile=certifi.where())
PORT = 8765
REDIRECT = f"http://localhost:{PORT}"
SCOPE = "https://www.googleapis.com/auth/cloud-platform"


def load_env() -> dict:
    env = {}
    for line in (Path(__file__).parent / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def main() -> int:
    env = load_env()
    cid = env["GOOGLE_OAUTH_CLIENT_ID"]
    secret = env["GOOGLE_OAUTH_CLIENT_SECRET"]

    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": cid,
        "redirect_uri": REDIRECT,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
    })
    print("\nOpen this URL in your browser and approve access:\n")
    print(url + "\n")
    print(f"(waiting on {REDIRECT} for the redirect...)")

    code_holder: dict = {}
    done = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            code_holder["code"] = (qs.get("code") or [None])[0]
            code_holder["error"] = (qs.get("error") or [None])[0]
            self.send_response(200)
            self.send_header("content-type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h2>Agent Fight City: Google linked. Close this tab.</h2>")
            done.set()

        def log_message(self, *a):
            pass

    server = http.server.HTTPServer(("localhost", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    done.wait(timeout=600)
    server.shutdown()

    if code_holder.get("error") or not code_holder.get("code"):
        print(f"authorization failed: {code_holder.get('error') or 'timeout'}")
        return 1

    body = urllib.parse.urlencode({
        "code": code_holder["code"],
        "client_id": cid,
        "client_secret": secret,
        "redirect_uri": REDIRECT,
        "grant_type": "authorization_code",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30, context=_CTX) as r:
        tok = json.load(r)

    refresh = tok.get("refresh_token")
    if not refresh:
        print("no refresh_token in response (already granted before?) — "
              "revoke access at myaccount.google.com/permissions and rerun")
        return 1

    with open(Path(__file__).parent / ".env", "a") as f:
        f.write(f"GOOGLE_REFRESH_TOKEN={refresh}\n")
    print("refresh token stored in harness/.env — Gemini fighter is ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
