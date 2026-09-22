#!/usr/bin/env python3
"""Loopback-only controlled HTTP fixture for AccessibilityRegressionUITests.

Deliberately not the Rust backend: it returns three same-name places with three
different categories so the test can read each row's localized category label.
Run with the iOS Test configuration, then stop this process when finished.
Binds only to 127.0.0.1; the test explicitly checks the fixture identity.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

SHARED_TITLE = "Same Name Place"
MARKERS = [
    {"id": 11, "version": 1, "lat": 31.2304, "lng": 121.4737,
     "category": "accessible_toilet", "title": SHARED_TITLE,
     "description": "Accessibility category fixture", "openTimeStart": "09:00",
     "openTimeEnd": "21:00", "contentLanguage": "en", "isPublic": True},
    {"id": 12, "version": 1, "lat": 31.2310, "lng": 121.4740,
     "category": "baby_room", "title": SHARED_TITLE,
     "description": "Accessibility category fixture", "openTimeStart": "09:00",
     "openTimeEnd": "21:00", "contentLanguage": "en", "isPublic": True},
    {"id": 13, "version": 1, "lat": 31.2316, "lng": 121.4743,
     "category": "friendly_clinic", "title": SHARED_TITLE,
     "description": "Accessibility category fixture", "openTimeStart": "09:00",
     "openTimeEnd": "21:00", "contentLanguage": "en", "isPublic": True},
]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, value, status=200):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/__ui_fixture":
            self.reply({"fixture": "lycoris-accessibility-regression", "markers": len(MARKERS)})
        elif path.startswith("/api/markers/") and path.rsplit("/", 1)[-1].isdigit():
            marker_id = int(path.rsplit("/", 1)[-1])
            match = next((m for m in MARKERS if m["id"] == marker_id), None)
            self.reply(match if match else {"code": 404}, 200 if match else 404)
        elif path in ("/api/markers/viewport", "/api/markers/search", "/api/markers/nearby"):
            self.reply(MARKERS)
        elif path == "/api/me":
            self.reply({"code": 401}, 401)
        else:
            self.reply({"code": 404}, 404)


if __name__ == "__main__":
    print("Accessibility iOS UI fixture listening only on 127.0.0.1:8080", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8080), Handler).serve_forever()
