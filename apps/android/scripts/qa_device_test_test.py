"""Offline runner safety tests. No adb, Docker, Android device, or live service is called."""

import json
from contextlib import redirect_stdout
import io
from pathlib import Path
import shlex
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch

import qa_device_test as runner

OWNER = "11111111-2222-4333-8444-555555555555"
UPLOAD = "22222222-3333-4444-8555-666666666666"
CREATION = "33333333-4444-4555-8666-777777777777"
PHOTO = "44444444-5555-4666-8777-888888888888"
PREFIX = ["/synthetic/adb", "-s", "emulator-synthetic"]


def permission_dump(granted, user=10, flags="USER_SET"):
    return (f"Packages:\n  Package [{runner.APP_ID}] (abc123):\n"
            "    requested permissions:\n"
            f"      {runner.LOCAL_NETWORK_PERMISSION}\n"
            "    User 0: installed=true hidden=false\n"
            "      runtime permissions:\n"
            f"        {runner.LOCAL_NETWORK_PERMISSION}: granted=true, flags=[ USER_SET]\n"
            f"    User {user}: installed=true hidden=false\n"
            "      runtime permissions:\n"
            f"        {runner.LOCAL_NETWORK_PERMISSION}: granted={str(granted).lower()}, flags=[ {flags}]\n"
            "        android.permission.ACCESS_FINE_LOCATION: granted=false, flags=[ ]\n")


class PermissionLog:
    """A strict simulated device; no subprocess or service is contacted."""
    def __init__(self, granted=False, grant_error=False, revoke_error=False):
        self.granted = granted
        self.grant_error = grant_error
        self.revoke_error = revoke_error
        self.flags = "USER_SET"
        self.user = 10
        self.commands = []
        self.messages = []
        self.path = None

    def run(self, command, label, input_text=None, timeout=60):
        self.commands.append(command)
        assert command[:3] == PREFIX, command
        arguments = command[3:]
        if arguments == ["get-state"]:
            return "device\n"
        if arguments[:3] == ["install", "--user", "10"]:
            return "Success\n"
        assert arguments[:2] == ["shell", "-T"], command
        arguments = arguments[2:]
        if arguments == ["dumpsys", "package", runner.APP_ID]:
            return permission_dump(self.granted, flags=self.flags)
        if arguments == ["am", "get-current-user"]:
            return str(self.user) + "\n"
        if arguments == ["getprop", "ro.build.version.sdk"]:
            return "37\n"
        if arguments == ["pm", "list", "instrumentation"]:
            return f"instrumentation:{runner.RUNNER} (target={runner.APP_ID})\n"
        if arguments[:5] == ["pm", "list", "packages", "--user", "10"]:
            assert arguments[5] in (runner.APP_ID, runner.TEST_ID)
            return "package:" + arguments[5] + "\n"
        if arguments == ["sh"]:
            assert self.granted
            assert shlex.split(input_text)[2:4] == ["--user", "10"]
            return successful_output()
        assert arguments in (["pm", "grant", "--user", "10", runner.APP_ID, runner.LOCAL_NETWORK_PERMISSION],
                             ["pm", "revoke", "--user", "10", runner.APP_ID, runner.LOCAL_NETWORK_PERMISSION]), command
        if arguments[1] == "grant":
            self.granted = True
            if self.grant_error:
                raise runner.QaDeviceFailure("Synthetic grant timeout after application.")
        else:
            if self.revoke_error:
                raise runner.QaDeviceFailure("Synthetic revoke failure.")
            self.granted = False
        return ""

    def write(self, message):
        self.messages.append(message)

    def close(self):
        pass

    def mutations(self):
        return [command[5:] for command in self.commands if command[5:7] in (["pm", "grant"], ["pm", "revoke"])]


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
        args = shlex.split(runner.instrument_command("android_qa_alice_1234abcd", password, 10))
        index = args.index("lycorisQaPassword")
        self.assertEqual(password, args[index + 1])
        self.assertEqual(runner.RUNNER, args[-1])
        self.assertEqual(1, args.count(password))
        self.assertEqual(["--user", "10"], args[2:4])

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


class LocalNetworkPermissionTest(unittest.TestCase):
    def test_apk_preflight_rejects_stale_app_without_qa_network_permission(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner, "ANDROID", Path(temporary)):
            outputs = Path(temporary) / "app/build/outputs/apk"
            files = []
            for relative, package, variant in (("qa/app-qa.apk", runner.APP_ID, "qa"),
                                               ("androidTest/qa/app-qa-androidTest.apk", runner.TEST_ID, "qaAndroidTest")):
                apk = outputs / relative
                apk.parent.mkdir(parents=True)
                apk.write_bytes(b"synthetic: aapt is mocked")
                apk.with_name("output-metadata.json").write_text(json.dumps({
                    "applicationId": package, "variantName": variant,
                    "elements": [{"outputFile": apk.name}],
                }))
                files.append(apk)
            app = f"package: name='{runner.APP_ID}' versionCode='1'\n"
            test = f"package: name='{runner.TEST_ID}' versionCode='1'\n"
            with patch.object(PermissionLog, "run", side_effect=[app, test]):
                with self.assertRaisesRegex(runner.QaDeviceFailure, "Rebuild the QA APK"):
                    runner.checked_apks("synthetic-aapt", PermissionLog())
            with patch.object(PermissionLog, "run", side_effect=[
                    app + f"uses-permission: name='{runner.LOCAL_NETWORK_PERMISSION}'\n", test]):
                self.assertEqual(files, runner.checked_apks("synthetic-aapt", PermissionLog()))

    def test_permission_is_declared_only_in_qa_source_manifest(self):
        manifests = list((runner.ANDROID / "app/src").glob("*/AndroidManifest.xml"))
        declared = []
        for path in manifests:
            names = [element.get("{http://schemas.android.com/apk/res/android}name")
                     for element in ET.parse(path).getroot().findall("uses-permission")]
            if runner.LOCAL_NETWORK_PERMISSION in names:
                declared.append(path.parent.name)
        self.assertEqual(["qa"], declared)

    def test_reads_exact_user_instead_of_another_users_granted_entry(self):
        state = runner.local_network_state(permission_dump(False), 10)
        self.assertFalse(state.granted)
        self.assertEqual(frozenset({"USER_SET"}), state.flags)
        self.assertTrue(runner.local_network_state(permission_dump(False), 0).granted)

    def test_missing_ambiguous_uninstalled_and_malformed_states_fail_closed(self):
        original = permission_dump(False)
        cases = [
            original.replace("User 10:", "User 11:"),
            original.replace("User 10: installed=true", "User 10: installed=false"),
            original.replace("granted=false, flags=[ USER_SET]", "granted=unknown, flags=[ USER_SET]"),
            original.replace("    User 10:", "    User 10: installed=true\n    User 10:"),
            original.replace("      runtime permissions:", "      other permissions:"),
            original + f"  Package [{runner.APP_ID}] (def456):\n",
            original.replace("granted=false, flags=[ USER_SET]", "granted=false, flags=[ USER_SET]\n"
                             f"        {runner.LOCAL_NETWORK_PERMISSION}: granted=true, flags=[ ]"),
            original.replace(f"        {runner.LOCAL_NETWORK_PERMISSION}: granted=false, flags=[ USER_SET]\n", ""),
        ]
        for dump in cases:
            with self.subTest(dump=dump), self.assertRaises(runner.QaDeviceFailure):
                runner.local_network_state(dump, 10)

    def test_denied_permission_is_granted_only_to_selected_user_then_restored(self):
        log = PermissionLog()
        with runner.temporary_local_network_permission(PREFIX, log, 37, 10):
            self.assertTrue(log.granted)
        self.assertFalse(log.granted)
        self.assertEqual([["pm", operation, "--user", "10", runner.APP_ID, runner.LOCAL_NETWORK_PERMISSION]
                          for operation in ("grant", "revoke")], log.mutations())

    def test_already_granted_permission_is_preserved_without_mutation(self):
        log = PermissionLog(granted=True)
        with runner.temporary_local_network_permission(PREFIX, log, 37, 10):
            self.assertTrue(log.granted)
        self.assertTrue(log.granted)
        self.assertEqual([], log.mutations())

    def test_older_sdk_does_not_read_or_mutate_new_permission(self):
        for sdk in (26, 36):
            log = PermissionLog()
            with runner.temporary_local_network_permission(PREFIX, log, sdk, 10):
                self.assertFalse(log.granted)
            self.assertEqual([], log.commands)

    def test_failure_and_keyboard_interrupt_restore_permission(self):
        for error in (runner.QaDeviceFailure("Synthetic test failed."), KeyboardInterrupt()):
            log = PermissionLog()
            with self.assertRaises(type(error)):
                with runner.temporary_local_network_permission(PREFIX, log, 37, 10):
                    raise error
            self.assertFalse(log.granted)
            self.assertEqual("revoke", log.mutations()[-1][1])

    def test_grant_timeout_after_effect_still_restores_permission(self):
        log = PermissionLog(grant_error=True)
        with self.assertRaisesRegex(runner.QaDeviceFailure, "grant timeout"):
            with runner.temporary_local_network_permission(PREFIX, log, 37, 10):
                self.fail("Test must not execute after an unconfirmed grant.")
        self.assertFalse(log.granted)

    def test_user_change_aborts_test_but_revoke_targets_original_user(self):
        log = PermissionLog()
        log.user = 11
        with self.assertRaisesRegex(runner.QaDeviceFailure, "user changed"):
            with runner.temporary_local_network_permission(PREFIX, log, 37, 10):
                self.fail("Test must not execute after an Android user switch.")
        self.assertFalse(log.granted)
        self.assertEqual("10", log.mutations()[-1][3])

    def test_fixed_permissions_are_not_overridden(self):
        for flag in ("POLICY_FIXED", "SYSTEM_FIXED", "USER_FIXED"):
            log = PermissionLog()
            log.flags = flag
            with self.assertRaisesRegex(runner.QaDeviceFailure, "fixed"):
                with runner.temporary_local_network_permission(PREFIX, log, 37, 10):
                    self.fail("Fixed permission must not be changed.")
            self.assertEqual([], log.mutations())

    def test_restore_failure_or_changed_flags_never_count_as_success(self):
        log = PermissionLog(revoke_error=True)
        with self.assertRaisesRegex(runner.QaDeviceFailure, "restoration failed"):
            with runner.temporary_local_network_permission(PREFIX, log, 37, 10):
                pass
        log = PermissionLog()
        with self.assertRaisesRegex(runner.QaDeviceFailure, "restoration failed"):
            with runner.temporary_local_network_permission(PREFIX, log, 37, 10):
                log.flags = "USER_SET|REVIEW_REQUIRED"
        self.assertFalse(log.granted)

    def test_unreadable_or_wrong_user_numbers_are_rejected(self):
        for value in ("", "current", "-1", "0\n10", "Error: permission denied", "01"):
            with patch.object(PermissionLog, "run", return_value=value), self.assertRaises(runner.QaDeviceFailure):
                runner.current_user(PREFIX, PermissionLog())

    def test_main_prints_passed_only_after_restore_and_never_after_restore_failure(self):
        for revoke_error in (False, True):
            with tempfile.TemporaryDirectory() as temporary:
                android = Path(temporary)
                log = PermissionLog(revoke_error=revoke_error)
                events = []
                def make_log(path, secrets):
                    log.path = path
                    return log
                def preflight():
                    self.assertEqual([], log.commands)
                    events.append("environment")
                def apks(*args):
                    self.assertEqual(["environment"], events)
                    self.assertEqual([], log.commands)
                    events.append("apks")
                    return [android / "qa.apk", android / "test.apk"]
                oracle = {"creationCount": 1, "proposalCount": 1, "totalBytes": 763045}
                output = io.StringIO()
                with patch.object(runner, "ANDROID", android), patch.object(runner, "STATE", android / "app/build/qa"), \
                        patch.object(runner, "read_alice", return_value={"username": "synthetic", "password": "private", "publicId": OWNER}), \
                        patch.object(runner, "CommandLog", side_effect=make_log), \
                        patch.object(runner, "executable", return_value=PREFIX[0]), \
                        patch.object(runner, "verify_local_environment", side_effect=preflight), \
                        patch.object(runner, "checked_apks", side_effect=apks), \
                        patch.object(runner, "database_oracle", return_value=oracle), redirect_stdout(output):
                    code = runner.main(["--serial", PREFIX[2]])
                result = json.loads(output.getvalue())
                self.assertEqual(1 if revoke_error else 0, code)
                self.assertEqual("failed" if revoke_error else "passed", result["status"])
                self.assertEqual(revoke_error, log.granted)
                self.assertEqual(["environment", "apks"], events)

    def test_failed_environment_or_apk_preflight_prevents_any_device_access(self):
        for fail_environment in (True, False):
            with tempfile.TemporaryDirectory() as temporary:
                android = Path(temporary)
                log = PermissionLog()
                log.path = android / "app/build/qa/device-tests/synthetic.log"
                fail = runner.QaDeviceFailure("Synthetic preflight rejection.")
                with patch.object(runner, "ANDROID", android), patch.object(runner, "STATE", android / "app/build/qa"), \
                        patch.object(runner, "read_alice", return_value={"username": "synthetic", "password": "private", "publicId": OWNER}), \
                        patch.object(runner, "CommandLog", return_value=log), patch.object(runner, "executable", return_value=PREFIX[0]), \
                        patch.object(runner, "verify_local_environment", side_effect=fail if fail_environment else None), \
                        patch.object(runner, "checked_apks", side_effect=fail), redirect_stdout(io.StringIO()):
                    self.assertEqual(1, runner.main(["--serial", PREFIX[2]]))
                self.assertEqual([], log.commands)


if __name__ == "__main__":
    unittest.main()
