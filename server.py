#!/usr/bin/env python3
"""Open Seats local server.

Serves the web UI, runs the AWS Builder ID sign-in (OAuth 2.0 authorization
code + PKCE) and proxies /api/* to the re:Invent Events API with the access
token. Tokens stay in this process's memory and never reach the browser.

Standard library only. Run: python3 server.py
"""

import base64
import hashlib
import json
import mimetypes
import os
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("OPEN_SEATS_PORT", "8484"))
if PORT not in range(8484, 8490):
    sys.exit("OPEN_SEATS_PORT must be 8484-8489 (the Events API's reserved loopback ports).")

ORIGIN = "http://localhost:%d" % PORT
REDIRECT_URI = ORIGIN + "/callback"
CLIENT_ID = "7vmom55m1qstvq8i71ph127bfq"  # public, shared client (no secret; PKCE)
AUTHORIZE_URL = "https://oauth.awsevents.com/oauth2/authorize"
TOKEN_URL = "https://oauth.awsevents.com/oauth2/token"
REVOKE_URL = "https://oauth.awsevents.com/oauth2/revoke"
API_BASE = "https://api.awsevents.com/v1"
SCOPE = "openid email events/access"
WEB_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
ALLOWED_HOSTS = {"localhost:%d" % PORT, "127.0.0.1:%d" % PORT}
CSRF_HEADER = "X-Open-Seats"  # custom header: cross-site pages can't send it without a preflight we never answer


class TokenStore:
    def __init__(self):
        self._lock = threading.Lock()
        self.access_token = None
        self.refresh_token = None
        self.expires_at = 0.0
        self.pending = {}  # state -> code_verifier

    def save(self, payload):
        with self._lock:
            self.access_token = payload["access_token"]
            # Refresh tokens may rotate: replace when a new one is returned.
            self.refresh_token = payload.get("refresh_token") or self.refresh_token
            self.expires_at = time.time() + int(payload.get("expires_in", 3600)) - 60

    def clear(self):
        with self._lock:
            self.access_token = self.refresh_token = None
            self.expires_at = 0.0

    @property
    def signed_in(self):
        return bool(self.access_token or self.refresh_token)


tokens = TokenStore()


def post_form(url, fields):
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = resp.read()
        return json.loads(body) if body else {}


def refresh():
    """Refresh once. Returns True on success; clears tokens on failure."""
    if not tokens.refresh_token:
        return False
    try:
        tokens.save(post_form(TOKEN_URL, {
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "refresh_token": tokens.refresh_token,
        }))
        return True
    except (urllib.error.URLError, ValueError, KeyError):
        tokens.clear()
        return False


def call_api(method, path, body):
    """Forward to the Events API. Refresh once on 401, then give up (per the docs)."""
    if tokens.access_token and time.time() >= tokens.expires_at:
        refresh()

    def send():
        headers = {"Accept": "application/json"}
        if tokens.access_token:
            headers["Authorization"] = "Bearer " + tokens.access_token
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(API_BASE + path, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as err:
            return err.code, err.read(), err.headers

    status, payload, headers = send()
    if status == 401 and refresh():
        status, payload, headers = send()
    if status == 401:
        tokens.clear()
    return status, payload, headers


class Handler(BaseHTTPRequestHandler):
    server_version = "OpenSeats/1.0"

    def log_message(self, fmt, *args):
        # Keep the console quiet but never log query strings (they carry auth codes).
        sys.stderr.write("%s %s\n" % (self.command, self.path.split("?")[0]))

    # --- helpers -----------------------------------------------------------
    def _host_ok(self):
        # Blocks DNS-rebinding: only answer requests addressed to this machine.
        return self.headers.get("Host", "") in ALLOWED_HOSTS

    def _send(self, status, body=b"", ctype="application/json", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj).encode())

    def _redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    # --- routes ------------------------------------------------------------
    def do_GET(self):
        if not self._host_ok():
            return self._send(421, b"Misdirected request", "text/plain")
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/auth/login":
            return self._login()
        if url.path == "/callback":
            return self._callback(urllib.parse.parse_qs(url.query))
        if url.path == "/auth/status":
            return self._json(200, {"signedIn": tokens.signed_in})
        if url.path.startswith("/api/"):
            return self._proxy("GET", url)
        return self._static(url.path)

    def do_POST(self):
        self._mutating("POST")

    def do_DELETE(self):
        self._mutating("DELETE")

    def do_PUT(self):
        self._mutating("PUT")

    def _mutating(self, method):
        if not self._host_ok():
            return self._send(421, b"Misdirected request", "text/plain")
        if self.headers.get(CSRF_HEADER) != "1":
            return self._json(403, {"message": "Missing %s header." % CSRF_HEADER})
        url = urllib.parse.urlsplit(self.path)
        if method == "POST" and url.path == "/auth/logout":
            return self._logout()
        if url.path.startswith("/api/"):
            return self._proxy(method, url)
        self._json(404, {"message": "Not found"})

    def _login(self):
        verifier = secrets.token_urlsafe(64)[:96]
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode()).digest()
        ).rstrip(b"=").decode()
        state = secrets.token_urlsafe(24)
        tokens.pending = {state: verifier}  # one sign-in attempt at a time
        query = urllib.parse.urlencode({
            "response_type": "code",
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "scope": SCOPE,
            "identity_provider": "AWSBuilderID",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": state,
        })
        self._redirect(AUTHORIZE_URL + "?" + query)

    def _callback(self, params):
        state = (params.get("state") or [""])[0]
        code = (params.get("code") or [""])[0]
        verifier = tokens.pending.pop(state, None)
        if not code or not verifier:
            return self._redirect("/?auth=failed")
        try:
            tokens.save(post_form(TOKEN_URL, {
                "grant_type": "authorization_code",
                "client_id": CLIENT_ID,
                "redirect_uri": REDIRECT_URI,
                "code": code,
                "code_verifier": verifier,
            }))
        except (urllib.error.URLError, ValueError, KeyError):
            return self._redirect("/?auth=failed")
        self._redirect("/")

    def _logout(self):
        if tokens.refresh_token:
            try:
                post_form(REVOKE_URL, {"client_id": CLIENT_ID, "token": tokens.refresh_token})
            except urllib.error.URLError:
                pass
        tokens.clear()
        self._json(200, {"signedIn": False})

    def _proxy(self, method, url):
        path = url.path[len("/api"):]
        if not path.startswith("/events"):
            return self._json(404, {"message": "Not found"})
        if url.query:
            path += "?" + url.query
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        status, payload, headers = call_api(method, path, body)
        extra = {}
        for name in ("Retry-After", "Content-Language"):
            if headers and headers.get(name):
                extra[name] = headers.get(name)
        self._send(status, payload, headers.get("Content-Type", "application/json") if headers else "application/json", extra)

    def _static(self, path):
        if path == "/":
            path = "/index.html"
        full = os.path.realpath(os.path.join(WEB_ROOT, path.lstrip("/")))
        if not full.startswith(os.path.realpath(WEB_ROOT) + os.sep) or not os.path.isfile(full):
            return self._send(404, b"Not found", "text/plain")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as fh:
            self._send(200, fh.read(), ctype, {
                "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
            })


def main():
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Open Seats running at %s  (Ctrl+C to stop)" % ORIGIN)
    if "--no-browser" not in sys.argv:
        threading.Timer(0.5, lambda: webbrowser.open(ORIGIN)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
