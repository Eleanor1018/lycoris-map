"""Regression tests for the guard that separates device QA writes from real services."""

import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from qa_gateway import FixtureIdentity, handler, ThreadingHTTPServer, MANIFEST_PATH
from qa_setup import ENVIRONMENT, SENTINEL_TITLE, SENTINEL_DESCRIPTION


class GatewayTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.sentinel = {"markerId": 41, "title": SENTINEL_TITLE, "description": SENTINEL_DESCRIPTION,
                         "ownerPublicId": "5586bac7-19be-4d4b-8930-86e53d8c6f75", "clientRequestId": "android-qa-sentinel-v1"}
        Path(self.directory.name, "fixtures.json").write_text(json.dumps({
            "testEnvironment": ENVIRONMENT, "protocolVersion": 1, "sentinel": self.sentinel}))
        self.identity = FixtureIdentity(Path(self.directory.name))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler(self.identity))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def fixture_response(self):
        marker = {"id": self.sentinel["markerId"], "title": SENTINEL_TITLE,
                  "description": SENTINEL_DESCRIPTION, "userPublicId": self.sentinel["ownerPublicId"],
                  "clientRequestId": self.sentinel["clientRequestId"], "isPublic": True,
                  "reviewStatus": "APPROVED"}
        return 200, [("Content-Type", "application/json")], json.dumps(marker).encode()

    def request(self, method, path, headers=None, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def write_headers(self):
        return {"X-Lycoris-Test-Environment": ENVIRONMENT, "X-Lycoris-Test-Nonce": self.identity.nonce}

    def test_manifest_requires_live_sentinel_and_has_per_instance_nonce(self):
        with patch("qa_gateway.upstream", return_value=self.fixture_response()) as upstream:
            status, headers, body = self.request("GET", MANIFEST_PATH)
        self.assertEqual(200, status)
        self.assertEqual(ENVIRONMENT, headers["X-Lycoris-Test-Environment"])
        self.assertEqual(self.identity.nonce, json.loads(body)["instanceNonce"])
        self.assertEqual(self.sentinel, json.loads(body)["sentinel"])
        self.assertEqual(1, upstream.call_count)
        self.assertNotEqual(self.identity.nonce, FixtureIdentity(Path(self.directory.name)).nonce)

    def test_wrong_service_cannot_issue_manifest(self):
        with patch("qa_gateway.upstream", return_value=(200, [], b'{"id":41,"title":"Real Place"}')):
            status, _, _ = self.request("GET", MANIFEST_PATH)
        self.assertEqual(503, status)

    def test_mutations_without_nonce_never_reach_upstream(self):
        with patch("qa_gateway.upstream") as upstream:
            for method in ("POST", "PATCH", "PUT", "DELETE"):
                self.assertEqual(403, self.request(method, "/api/login", body=b"{}")[0])
        upstream.assert_not_called()

    def test_stale_nonce_never_reaches_upstream(self):
        headers = self.write_headers()
        with patch("qa_gateway.upstream") as upstream:
            for nonce in ("0" * 64, "é" * 64):
                headers["X-Lycoris-Test-Nonce"] = nonce
                status, _, _ = self.request("POST", "/api/login", headers, b"{}")
                self.assertEqual(403, status)
        upstream.assert_not_called()

    def test_changed_sentinel_blocks_even_correct_nonce(self):
        with patch("qa_gateway.upstream", return_value=(404, [], b"")) as upstream:
            status, _, _ = self.request("DELETE", "/api/markers/1/favorite", self.write_headers())
        self.assertEqual(503, status)
        self.assertEqual([("GET", "/api/markers/41?lang=en")], [call.args for call in upstream.call_args_list])

    def test_verified_mutation_preserves_empty_success_and_cookie(self):
        with patch("qa_gateway.upstream", side_effect=[self.fixture_response(),
                  (200, [("Set-Cookie", "LYCORIS_ANDROID_QA=test; HttpOnly")], b"")]) as upstream:
            status, headers, body = self.request("POST", "/api/login", self.write_headers(), b"{}")
        self.assertEqual(200, status)
        self.assertEqual(b"", body)
        self.assertIn("Set-Cookie", headers)
        forwarded_headers = upstream.call_args_list[-1].args[3]
        self.assertNotIn("X-Lycoris-Test-Nonce", forwarded_headers)

    def test_redirect_and_absolute_url_refused(self):
        with patch("qa_gateway.upstream") as upstream:
            self.assertEqual(400, self.request("GET", "https://lycoris-map.com/api/markers/public")[0])
        upstream.assert_not_called()
        with patch("qa_gateway.upstream", return_value=(302, [("Location", "https://lycoris-map.com/")], b"")):
            status, headers, _ = self.request("GET", "/api/markers/public")
        self.assertEqual(502, status)
        self.assertNotIn("Location", headers)


if __name__ == "__main__":
    unittest.main()
