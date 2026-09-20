#!/usr/bin/env python3
"""Fail-closed loopback gateway for the synthetic Android QA backend."""

import argparse
import hmac
from http.client import HTTPConnection, HTTPException
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
from urllib.parse import urlsplit

from qa_setup import DEFAULT_STATE, ENVIRONMENT, SENTINEL_DESCRIPTION, SENTINEL_TITLE

MAX_BODY_BYTES = 6 * 1024 * 1024
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
MANIFEST_PATH = "/__lycoris_qa__/manifest"
HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
               "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"}


def upstream(method, path, body=None, headers=None):
    """No configurable upstream, system proxies, redirects, or public network fallback."""
    connection = HTTPConnection("127.0.0.1", 18186, timeout=20)
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read(MAX_RESPONSE_BYTES + 1)
        if len(payload) > MAX_RESPONSE_BYTES:
            raise ValueError("QA upstream response exceeds the test gateway limit.")
        return response.status, response.getheaders(), payload
    finally:
        connection.close()


class FixtureIdentity:
    def __init__(self, state):
        value = json.loads((state / "fixtures.json").read_text())
        if value.get("testEnvironment") != ENVIRONMENT or value.get("protocolVersion") != 1:
            raise ValueError("Unknown QA fixture environment.")
        sentinel = value["sentinel"]
        if (type(sentinel["markerId"]) is not int or sentinel["markerId"] <= 0
                or sentinel["title"] != SENTINEL_TITLE or sentinel["description"] != SENTINEL_DESCRIPTION
                or sentinel["clientRequestId"] != "android-qa-sentinel-v1"):
            raise ValueError("Invalid synthetic sentinel configuration.")
        self.sentinel = sentinel
        self.nonce = secrets.token_hex(32)

    def verify(self):
        status, _, body = upstream("GET", f"/api/markers/{self.sentinel['markerId']}?lang=en")
        if status != 200:
            raise ValueError("Synthetic sentinel is unavailable.")
        marker = json.loads(body)
        expected = {"id": self.sentinel["markerId"], "title": self.sentinel["title"],
                    "description": self.sentinel["description"],
                    "userPublicId": self.sentinel["ownerPublicId"],
                    "clientRequestId": self.sentinel["clientRequestId"],
                    "isPublic": True, "reviewStatus": "APPROVED"}
        if any(marker.get(key) != value for key, value in expected.items()):
            raise ValueError("Synthetic sentinel identity mismatch.")

    def manifest(self):
        self.verify()
        return {"testEnvironment": ENVIRONMENT, "protocolVersion": 1, "instanceNonce": self.nonce,
                "upstream": "http://127.0.0.1:18186/", "sentinel": self.sentinel}

    def permits_write(self, headers):
        return (headers.get("X-Lycoris-Test-Environment") == ENVIRONMENT
                and hmac.compare_digest(headers.get("X-Lycoris-Test-Nonce", "").encode(), self.nonce.encode()))


def handler(identity):
    class Gateway(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "LycorisSyntheticQA/1"

        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def log_message(self, format_string, *args):
            # Avoid logging query strings, account details, cookie values, or test nonce.
            pass

        def json_response(self, status, value):
            payload = json.dumps(value, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Lycoris-Test-Environment", ENVIRONMENT)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)

        def forward(self):
            parsed = urlsplit(self.path)
            if parsed.scheme or parsed.netloc or self.path.startswith("//"):
                self.json_response(400, {"error": "Only relative local QA paths are accepted."})
                return
            if parsed.path == MANIFEST_PATH:
                if self.command not in {"GET", "HEAD"}:
                    self.json_response(405, {"error": "Read-only QA manifest."})
                    return
                try:
                    self.json_response(200, identity.manifest())
                except (OSError, ValueError, HTTPException):
                    self.json_response(503, {"error": "Synthetic QA identity is not verified."})
                return
            if not any(parsed.path.startswith(prefix) for prefix in ("/api/", "/uploads/", "/health/")):
                self.json_response(404, {"error": "Outside QA API routes."})
                return
            mutation = self.command not in {"GET", "HEAD", "OPTIONS"}
            if mutation and not identity.permits_write(self.headers):
                self.close_connection = True
                self.json_response(403, {"error": "Synthetic QA preflight and current instance nonce are required."})
                return
            if self.headers.get("Transfer-Encoding"):
                self.close_connection = True
                self.json_response(400, {"error": "QA requests require a bounded Content-Length."})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = -1
            if not 0 <= length <= MAX_BODY_BYTES:
                self.close_connection = True
                self.json_response(413, {"error": "QA request body limit exceeded."})
                return
            try:
                if mutation:
                    identity.verify()
                body = self.rfile.read(length) if length else None
                if length and len(body) != length:
                    raise ValueError("Incomplete request body.")
                headers = {key: value for key, value in self.headers.items()
                           if key.lower() not in HOP_HEADERS and not key.lower().startswith("x-lycoris-test-")}
                status, response_headers, payload = upstream(self.command, self.path, body, headers)
                # The local backend has no redirect-based API contract. Fail closed.
                if 300 <= status < 400 and any(key.lower() == "location" for key, _ in response_headers):
                    self.json_response(502, {"error": "QA upstream redirect refused."})
                    return
                self.send_response(status)
                for key, value in response_headers:
                    if key.lower() not in HOP_HEADERS and key.lower() != "x-lycoris-test-environment":
                        self.send_header(key, value)
                self.send_header("X-Lycoris-Test-Environment", ENVIRONMENT)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(payload)
            except (OSError, ValueError, HTTPException):
                self.close_connection = True
                self.json_response(503, {"error": "Synthetic QA backend or identity is unavailable."})

        do_GET = forward
        do_HEAD = forward
        do_POST = forward
        do_PATCH = forward
        do_PUT = forward
        do_DELETE = forward
        do_OPTIONS = forward

    return Gateway


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE)
    args = parser.parse_args()
    identity = FixtureIdentity(args.state_dir.resolve())
    identity.verify()
    server = ThreadingHTTPServer(("127.0.0.1", 18187), handler(identity))
    server.daemon_threads = True
    print("Verified synthetic Android QA gateway on 127.0.0.1:18187; writes require preflight nonce.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
