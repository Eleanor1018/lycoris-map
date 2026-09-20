"""Offline runner safety tests. No adb, Docker, Android device, or live service is called."""

import json
from pathlib import Path
import shlex
import tempfile
import unittest
from unittest.mock import patch

import qa_device_test as runner

OWNER = "11111111-2222-4333-8444-555555555555"
UPLOAD = "22222222-3333-4444-8555-666666666666"
CREATION = "33333333-4444-4555-8666-777777777777"
PHOTO = "44444444-5555-4666-8777-888888888888"


def successful_output():
    fields = dict(zip(runner.RECEIPT_KEYS, ("6", UPLOAD, CREATION, PHOTO, OWNER)))
    status = "\n".join("INSTRUMENTATION_STATUS: " + key + "=" + value for key, value in fields.items())
    return (f"INSTRUMENTATION_STATUS: class={runner.TEST_CLASS}\n"
            f"INSTRUMENTATION_STATUS: test={runner.TEST_METHOD}\n"
            "INSTRUMENTATION_STATUS_CODE: 1\n" + status + "\n"
            "INSTRUMENTATION_STATUS_CODE: 0\n"
            "INSTRUMENTATION_RESULT: stream=\nTime: 1.0\n\nOK (1 test)\n\n"
            "INSTRUMENTATION_CODE: -1\n")


class DeviceRunnerTest(unittest.TestCase):
    def test_success_requires_one_test_and_all_valid_opaque_receipts(self):
        receipt = runner.parse_instrumentation(successful_output(), OWNER)
        self.assertEqual(6, receipt["lycorisQaMarkerId"])
        self.assertEqual(PHOTO, receipt["lycorisQaPhotoRequestId"])

    def test_skips_failures_crashes_missing_code_and_wrong_class_are_not_success(self):
        base = successful_output()
        mutations = [
            base.replace("INSTRUMENTATION_STATUS_CODE: 0", "INSTRUMENTATION_STATUS_CODE: -4"),
            base.replace("INSTRUMENTATION_STATUS_CODE: 0", "INSTRUMENTATION_STATUS_CODE: -2"),
            base.replace("OK (1 test)", "OK (0 tests)"),
            base.replace("INSTRUMENTATION_CODE: -1", "INSTRUMENTATION_CODE: 0"),
            base.replace(runner.TEST_CLASS, "other.Test"),
            base + "INSTRUMENTATION_FAILED: crash\n",
            base + "INSTRUMENTATION_RESULT: shortMsg=Process crashed.\n",
            base + "INSTRUMENTATION_CODE: -1\n",
            base.replace("INSTRUMENTATION_STATUS: lycorisQaMarkerId=6\n", ""),
            base + "INSTRUMENTATION_STATUS: lycorisQaMarkerId=6\n",
        ]
        for output in mutations:
            with self.subTest(output=output[-80:]), self.assertRaises(runner.QaDeviceFailure):
                runner.parse_instrumentation(output, OWNER)

    def test_marker_uuid_sql_injection_and_cross_owner_are_rejected_before_oracle(self):
        base = successful_output()
        for before, after in (("lycorisQaMarkerId=6", "lycorisQaMarkerId=6;DROP TABLE users"),
                              ("lycorisQaMarkerId=6", "lycorisQaMarkerId=9223372036854775808"),
                              (UPLOAD, "' OR 1=1 --"), (OWNER, UPLOAD)):
            with self.assertRaises(runner.QaDeviceFailure):
                runner.parse_instrumentation(base.replace(before, after), OWNER)

    def test_password_is_posix_quoted_without_becoming_shell_code(self):
        password = "private ' \" $HOME $(touch nope) `id` ; & spaces"
        args = shlex.split(runner.instrument_command("android_qa_alice_1234abcd", password))
        index = args.index("lycorisQaPassword")
        self.assertEqual(password, args[index + 1])
        self.assertEqual(runner.RUNNER, args[-1])
        self.assertEqual(1, args.count(password))

    def test_logs_redact_credentials_and_sensitive_headers(self):
        text = "user synthetic-user password synthetic-pass\nAuthorization: token-value\nSet-Cookie: session=value\nCookie: private=cookie"
        safe = runner.redact(text, ("synthetic-user", "synthetic-pass"))
        for secret in ("synthetic-user", "synthetic-pass", "token-value", "session=value", "private=cookie"):
            self.assertNotIn(secret, safe)

    def test_reads_only_seeded_private_alice_credentials(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(runner, "STATE", Path(temp)):
            path = Path(temp) / "credentials.json"
            value = {"testEnvironment": runner.qa_setup.ENVIRONMENT, "users": [
                {"username": "android_qa_bob_1234abcd", "password": "b" * 32, "publicId": UPLOAD},
                {"username": "android_qa_alice_1234abcd", "password": "a" * 32, "publicId": OWNER},
            ]}
            path.write_text(json.dumps(value))
            path.chmod(0o600)
            self.assertEqual(OWNER, runner.read_alice()["publicId"])
            path.chmod(0o644)
            with self.assertRaises(runner.QaDeviceFailure): runner.read_alice()
            path.chmod(0o600)
            value["testEnvironment"] = "production"
            path.write_text(json.dumps(value))
            with self.assertRaises(runner.QaDeviceFailure): runner.read_alice()

    def test_database_oracle_requires_read_only_transaction_and_exactly_one_proposal(self):
        receipt = runner.parse_instrumentation(successful_output(), OWNER)
        good = {"creationCount": 1, "markerMatches": 1, "uploadCount": 1, "proposalCount": 1,
                "proposalMatches": 1, "status": "COMPLETED", "totalBytes": 763045,
                "receivedBytes": 763045, "stagedBytes": 0}
        with patch.object(runner.qa_setup, "verify_backend") as verify, patch.object(runner.qa_setup, "docker", return_value=json.dumps(good)) as docker:
            self.assertEqual(good, runner.database_oracle(receipt))
            verify.assert_called_once()
            args = docker.call_args.args
            self.assertEqual(("exec", runner.qa_setup.DB_CONTAINER, "psql"), args[:3])
            self.assertIn("BEGIN TRANSACTION READ ONLY;", args[-1])
            self.assertTrue(args[-1].endswith("COMMIT;"))
            self.assertNotIn("UPDATE ", args[-1])
            self.assertNotIn("DELETE ", args[-1])
        for key, value in (("creationCount", 2), ("proposalCount", 2), ("proposalMatches", 0),
                           ("stagedBytes", 763045), ("status", "UPLOADING"), ("receivedBytes", 262144)):
            with patch.object(runner.qa_setup, "verify_backend"), patch.object(runner.qa_setup, "docker", return_value=json.dumps({**good, key: value})):
                with self.assertRaises(runner.QaDeviceFailure): runner.database_oracle(receipt)


if __name__ == "__main__":
    unittest.main()
