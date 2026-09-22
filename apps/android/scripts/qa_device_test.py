#!/usr/bin/env python3
"""Opt in to one guarded native QA integration test on an explicitly selected device."""

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import http.client
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import sys
import uuid

import qa_setup
from qa_gateway import FixtureIdentity

HERE = Path(__file__).resolve().parent
ANDROID = HERE.parent
STATE = ANDROID / "app/build/qa"
APP_ID = "com.lycoris.maps.qa"
TEST_ID = APP_ID + ".test"
RUNNER = TEST_ID + "/androidx.test.runner.AndroidJUnitRunner"
LOCAL_NETWORK_PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK"
TEST_CLASS = "com.lycoris.maps.feature.contributions.QaBackendIntegrationTest"
TEST_METHOD = "realRustSessionFavoritesIdempotentCreationAndResumableImage"
RECEIPT_KEYS = (
    "lycorisQaMarkerId", "lycorisQaUploadId", "lycorisQaCreationRequestId",
    "lycorisQaPhotoRequestId", "lycorisQaOwnerPublicId",
)
# Fixed allowlist of instrumentation stage names. Only these exact values may be reported.
BACKEND_STAGES = (
    "preflight", "login", "restore", "favorites", "create", "upload", "complete", "cleanup",
)
UUID_PATTERN = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


class QaDeviceFailure(Exception):
    """Contains only predetermined, non-sensitive diagnostic messages."""

    def __init__(self, message, backend_stage=None):
        super().__init__(message)
        # Optional fixed stage name from BACKEND_STAGES; never arbitrary instrumentation text.
        self.backend_stage = backend_stage if backend_stage in BACKEND_STAGES else None


def reported_stage(output):
    """Return the fixed stage that should be attributed to a failure, if any.

    Prefer the explicit failure marker the test emits once, so a later cleanup failure cannot
    rewrite the original cause. Without it, fall back to the last fixed stage reported — this
    still includes cleanup, so a crash during cleanup remains localizable.
    """
    failed = re.findall(r"^INSTRUMENTATION_STATUS: lycorisQaFailedStage=([A-Za-z0-9_]*)\s*$", output, re.MULTILINE)
    for stage in failed:
        if stage in BACKEND_STAGES:
            return stage
    stages = re.findall(r"^INSTRUMENTATION_STATUS: lycorisQaStage=([A-Za-z0-9_]*)\s*$", output, re.MULTILINE)
    legal = [stage for stage in stages if stage in BACKEND_STAGES]
    return legal[-1] if legal else None


def canonical_uuid(value):
    if not isinstance(value, str) or not UUID_PATTERN.fullmatch(value):
        raise QaDeviceFailure("Invalid UUID in QA receipt.")
    if str(uuid.UUID(value)) != value:
        raise QaDeviceFailure("Noncanonical UUID in QA receipt.")
    return value


def redact(text, secrets):
    for value in sorted((item for item in secrets if item), key=len, reverse=True):
        text = text.replace(value, "[REDACTED]")
    return re.sub(r"(?im)^.*(?:set-cookie|cookie|authorization|lycorisQaPassword|lycorisQaUsername)\s*[:=].*$",
                  "[REDACTED sensitive line]", text)


def read_alice():
    path = STATE / "credentials.json"
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 64 * 1024:
        raise QaDeviceFailure("Expected the private generated QA credentials file.")
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise QaDeviceFailure("QA credentials must be private to the current user (chmod 600).")
    try:
        value = json.loads(path.read_text())
        if value.get("testEnvironment") != qa_setup.ENVIRONMENT:
            raise ValueError()
        users = [item for item in value["users"] if isinstance(item, dict)
                 and re.fullmatch(r"android_qa_alice_[0-9a-f]{8}", item.get("username", ""))]
        if len(users) != 1:
            raise ValueError()
        user = users[0]
        password = user["password"]
        if not isinstance(password, str) or not 16 <= len(password) <= 512 or any(ord(c) < 32 for c in password):
            raise ValueError()
        canonical_uuid(user["publicId"])
        return {key: user[key] for key in ("username", "password", "publicId")}
    except (KeyError, ValueError, TypeError):
        raise QaDeviceFailure("QA credentials are invalid or unseeded; run the isolated setup first.") from None


def sdk_roots():
    roots = [Path(value) for key in ("ANDROID_SDK_ROOT", "ANDROID_HOME") if (value := os.getenv(key))]
    properties = ANDROID / "local.properties"
    if properties.is_file():
        for line in properties.read_text().splitlines():
            if line.strip().startswith("sdk.dir="):
                roots.append(Path(line.split("=", 1)[1].replace(r"\:", ":").replace(r"\ ", " ").replace("\\\\", "\\")))
    roots += [Path.home() / "Library/Android/sdk", Path.home() / "Android/Sdk"]
    return list(dict.fromkeys(roots))


def executable(override, name):
    candidates = [Path(override)] if override else []
    if not override:
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))
        for root in sdk_roots():
            if name == "adb":
                candidates.append(root / "platform-tools/adb")
            else:
                candidates.extend(sorted((root / "build-tools").glob("*/aapt2"), reverse=True))
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate.resolve())
    raise QaDeviceFailure("Required Android SDK tool is missing; supply --adb and/or --aapt2.")


class CommandLog:
    def __init__(self, path, secrets):
        self.path = path
        self.secrets = secrets
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        self.stream = os.fdopen(descriptor, "w")

    def write(self, value):
        self.stream.write(redact(value, self.secrets) + "\n")
        self.stream.flush()

    def run(self, command, label, input_text=None, timeout=60):
        # Never print command lines or stdin. Credentials go only through the pipe to a noninteractive shell.
        try:
            result = subprocess.run(command, input=input_text, text=True, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, timeout=timeout, check=False)
        except subprocess.TimeoutExpired as error:
            output = error.stdout or b""
            if isinstance(output, bytes):
                output = output.decode("utf-8", errors="replace")
            self.write(label + ": timeout\n" + output)
            raise QaDeviceFailure(label + " timed out.") from None
        self.write(label + "\n" + result.stdout + "\n" + result.stderr)
        if result.returncode:
            raise QaDeviceFailure(label + " failed; see the sanitized log.")
        return result.stdout

    def close(self):
        self.stream.close()


def verify_local_environment():
    if os.getenv("DOCKER_HOST") and not os.environ["DOCKER_HOST"].startswith("unix://"):
        raise QaDeviceFailure("QA requires a local Unix-socket Docker endpoint.")
    context = json.loads(qa_setup.docker("context", "inspect"))[0]
    if not context.get("Endpoints", {}).get("docker", {}).get("Host", "").startswith("unix://"):
        raise QaDeviceFailure("QA requires a local Unix-socket Docker context.")
    qa_setup.verify_backend()  # Existing fixed container/database/port/cookie-name verification.
    identity = FixtureIdentity(STATE)
    connection = http.client.HTTPConnection("127.0.0.1", 18187, timeout=8)
    try:
        connection.request("GET", "/__lycoris_qa__/manifest", headers={"User-Agent": "LycorisAndroidSyntheticQA/DeviceRunner"})
        response = connection.getresponse()
        body = response.read(16_385)
        if response.status != 200 or response.getheader("X-Lycoris-Test-Environment") != qa_setup.ENVIRONMENT or len(body) > 16_384:
            raise QaDeviceFailure("The guarded local QA gateway is unavailable.")
        manifest = json.loads(body)
        if (manifest.get("testEnvironment") != qa_setup.ENVIRONMENT or manifest.get("protocolVersion") != 1
                or manifest.get("upstream") != "http://127.0.0.1:18186/"
                or not re.fullmatch(r"[0-9a-f]{64}", manifest.get("instanceNonce", ""))
                or manifest.get("sentinel") != identity.sentinel):
            raise QaDeviceFailure("The QA gateway manifest does not match the local synthetic fixtures.")
    finally:
        connection.close()


def checked_apks(aapt2, log):
    outputs = ANDROID / "app/build/outputs/apk"
    expected = ((outputs / "qa/app-qa.apk", APP_ID, "qa"),
                (outputs / "androidTest/qa/app-qa-androidTest.apk", TEST_ID, "qaAndroidTest"))
    for path, application_id, variant in expected:
        if path.is_symlink() or not path.is_file():
            raise QaDeviceFailure("Build the fixed QA app and QA androidTest APKs before running.")
        metadata = json.loads(path.with_name("output-metadata.json").read_text())
        elements = metadata.get("elements", [])
        if (metadata.get("applicationId") != application_id or metadata.get("variantName") != variant
                or len(elements) != 1 or elements[0].get("outputFile") != path.name):
            raise QaDeviceFailure("APK output metadata is not the required QA variant.")
        badging = log.run([aapt2, "dump", "badging", str(path)], "Verify QA APK identity")
        match = re.search(r"^package: name='([^']+)'", badging, flags=re.MULTILINE)
        if not match or match.group(1) != application_id:
            raise QaDeviceFailure("APK manifest package is not the required QA application.")
        if application_id == APP_ID and not re.search(
                r"^uses-permission: name='" + re.escape(LOCAL_NETWORK_PERMISSION) + r"'(?:\s|$)",
                badging, re.MULTILINE):
            raise QaDeviceFailure("Rebuild the QA APK with its QA-only local network permission.")
    return [item[0] for item in expected]


def device_number(prefix, log, arguments, label, minimum=0):
    value = log.run([*prefix, "shell", "-T", *arguments], label).strip()
    if not re.fullmatch(r"0|[1-9][0-9]{0,8}", value) or int(value) < minimum:
        raise QaDeviceFailure("Cannot determine the selected device's SDK or current Android user.")
    return int(value)


def current_user(prefix, log):
    return device_number(prefix, log, ["am", "get-current-user"], "Read selected Android user")


@dataclass(frozen=True)
class RuntimePermissionState:
    granted: bool
    flags: frozenset


def local_network_state(dump, user_id):
    """Read exactly one installed QA package/user/runtime entry; absence is not denial."""
    lines = dump.splitlines()

    def section(items, pattern):
        matches = [i for i, line in enumerate(items) if re.fullmatch(pattern, line)]
        if len(matches) != 1:
            raise QaDeviceFailure("Cannot unambiguously read the QA local network permission state.")
        start = matches[0]
        indent = len(items[start]) - len(items[start].lstrip())
        end = next((i for i in range(start + 1, len(items)) if items[i].strip()
                    and len(items[i]) - len(items[i].lstrip()) <= indent), len(items))
        return items[start], items[start + 1:end]

    _, package = section(lines, r"\s+Package \[" + re.escape(APP_ID) + r"\] \([^\r\n]+\):")
    header, user = section(package, r"\s+User " + str(user_id) + r":.*")
    if re.findall(r"\binstalled=(true|false)\b", header) != ["true"]:
        raise QaDeviceFailure("The QA app is not installed for the selected Android user.")
    _, permissions = section(user, r"\s+runtime permissions:")
    matching = [line.strip() for line in permissions if line.strip().startswith(LOCAL_NETWORK_PERMISSION + ":")]
    if len(matching) != 1:
        raise QaDeviceFailure("The selected user's QA local network permission is missing or ambiguous.")
    match = re.fullmatch(re.escape(LOCAL_NETWORK_PERMISSION) + r": granted=(true|false), flags=\[([ A-Z0-9_|]*)\]", matching[0])
    if not match:
        raise QaDeviceFailure("Unrecognized QA local network permission state.")
    flags = frozenset(item.strip() for item in match.group(2).split("|") if item.strip())
    if any(not re.fullmatch(r"[A-Z][A-Z0-9_]*", flag) for flag in flags):
        raise QaDeviceFailure("Unrecognized QA local network permission flags.")
    return RuntimePermissionState(match.group(1) == "true", flags)


@contextmanager
def temporary_local_network_permission(prefix, log, sdk, user_id):
    if sdk < 37:
        yield
        return

    def read_state():
        return local_network_state(log.run([*prefix, "shell", "-T", "dumpsys", "package", APP_ID],
                                          "Read QA local network permission"), user_id)

    def change(operation):
        log.run([*prefix, "shell", "-T", "pm", operation, "--user", str(user_id), APP_ID,
                 LOCAL_NETWORK_PERMISSION], "QA local network permission " + operation)

    original = read_state()
    if not original.granted and original.flags & {"SYSTEM_FIXED", "POLICY_FIXED", "USER_FIXED"}:
        raise QaDeviceFailure("The QA local network permission is fixed; no permission was changed.")
    attempted = False
    try:
        if not original.granted:
            # Set before adb: a timeout can happen after Android has already applied the grant.
            attempted = True
            change("grant")
            if read_state() != RuntimePermissionState(True, original.flags):
                raise QaDeviceFailure("Temporary QA local network permission was not confirmed.")
        if current_user(prefix, log) != user_id:
            raise QaDeviceFailure("The active Android user changed; refusing to run instrumentation.")
        yield
    finally:
        try:
            if attempted:
                # The explicit original user is retained even if the foreground user changed.
                change("revoke")
            if read_state() != original:
                raise QaDeviceFailure("QA local network permission restoration could not be verified.")
            log.write("QA local network permission restored for Android user " + str(user_id) + ".")
        except (Exception, KeyboardInterrupt):
            raise QaDeviceFailure("QA local network permission restoration failed; this run is not successful. Inspect the selected QA package/user before retrying.") from None


def instrument_command(username, password, user_id):
    # POSIX quoting also covers spaces, quotes, $, and backticks. adb receives no secret in its host argv.
    arguments = ["am", "instrument", "--user", str(user_id), "-w", "-r", "-e", "class", TEST_CLASS,
                 "-e", "lycorisQaUsername", username, "-e", "lycorisQaPassword", password, RUNNER]
    return shlex.join(arguments) + "\n"


def parse_instrumentation(output, expected_owner):
    stage = reported_stage(output)
    if (not re.search(r"^OK \(1 test\)\s*$", output, re.MULTILINE)
            or re.findall(r"^INSTRUMENTATION_CODE: (-?\d+)\s*$", output, re.MULTILINE) != ["-1"]
            or re.search(r"^INSTRUMENTATION_STATUS_CODE: -[1-9]\d*\s*$", output, re.MULTILINE)
            or re.search(r"(?:FAILURES!!!|INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED|INSTRUMENTATION_RESULT: shortMsg=)", output)):
        raise QaDeviceFailure("The fixed live integration test did not pass; skipped tests are not success.", stage)
    classes = re.findall(r"^INSTRUMENTATION_STATUS: class=(.*)$", output, re.MULTILINE)
    methods = re.findall(r"^INSTRUMENTATION_STATUS: test=(.*)$", output, re.MULTILINE)
    if not classes or set(classes) != {TEST_CLASS} or not methods or set(methods) != {TEST_METHOD}:
        raise QaDeviceFailure("Unexpected instrumentation test identity.", stage)
    receipt = {}
    for key in RECEIPT_KEYS:
        values = re.findall(r"^INSTRUMENTATION_STATUS: " + re.escape(key) + r"=(.*)$", output, re.MULTILINE)
        if len(values) != 1:
            raise QaDeviceFailure("Missing or repeated QA database receipt.", stage)
        receipt[key] = values[0].strip()
    marker = receipt[RECEIPT_KEYS[0]]
    if not re.fullmatch(r"[1-9][0-9]{0,18}", marker) or int(marker) > 2**63 - 1:
        raise QaDeviceFailure("Invalid marker ID in QA receipt.", stage)
    receipt[RECEIPT_KEYS[0]] = int(marker)
    for key in RECEIPT_KEYS[1:]:
        receipt[key] = canonical_uuid(receipt[key])
    if receipt["lycorisQaOwnerPublicId"] != canonical_uuid(expected_owner):
        raise QaDeviceFailure("The QA receipt belongs to a different synthetic account.", stage)
    return receipt


def database_oracle(receipt):
    # Values can only be canonical UUIDs and a bounded positive integer from parse_instrumentation.
    marker = receipt["lycorisQaMarkerId"]
    owner = canonical_uuid(receipt["lycorisQaOwnerPublicId"])
    creation = canonical_uuid(receipt["lycorisQaCreationRequestId"])
    photo = canonical_uuid(receipt["lycorisQaPhotoRequestId"])
    upload = canonical_uuid(receipt["lycorisQaUploadId"])
    if not isinstance(marker, int) or isinstance(marker, bool) or not 0 < marker < 2**63:
        raise QaDeviceFailure("Invalid marker ID for the read-only oracle.")
    qa_setup.verify_backend()  # Recheck the fixed database immediately before the read-only transaction.
    query = f"""BEGIN TRANSACTION READ ONLY;
SELECT json_build_object(
 'creationCount', (SELECT count(*) FROM map_markers WHERE user_public_id='{owner}' AND client_request_id='{creation}'),
 'markerMatches', (SELECT count(*) FROM map_markers WHERE id={marker} AND user_public_id='{owner}' AND client_request_id='{creation}' AND title='Android QA integration {creation}' AND review_status='PENDING'),
 'uploadCount', (SELECT count(*) FROM marker_image_uploads WHERE owner_public_id='{owner}'::uuid AND client_request_id='{photo}'::uuid AND marker_id={marker}),
 'proposalCount', (SELECT count(*) FROM marker_image_proposals WHERE marker_id={marker}),
 'proposalMatches', (SELECT count(*) FROM marker_image_proposals WHERE id=u.proposal_id AND marker_id={marker} AND proposer_public_id='{owner}' AND status='PENDING'),
 'status', u.status, 'totalBytes', u.total_bytes, 'receivedBytes', u.received_bytes,
 'stagedBytes', octet_length(u.staged_bytes))
FROM marker_image_uploads u WHERE u.upload_id='{upload}'::uuid AND u.owner_public_id='{owner}'::uuid
 AND u.client_request_id='{photo}'::uuid AND u.marker_id={marker};
COMMIT;"""
    raw = qa_setup.docker("exec", qa_setup.DB_CONTAINER, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
                          "-U", qa_setup.DATABASE, "-d", qa_setup.DATABASE, "-c", query)
    try:
        result = json.loads(raw.strip())
        if (any(result.get(key) != 1 for key in ("creationCount", "markerMatches", "uploadCount", "proposalCount", "proposalMatches"))
                or result.get("status") != "COMPLETED" or result.get("stagedBytes") != 0
                or not 262144 < result.get("totalBytes", 0) <= 5242880
                or result.get("receivedBytes") != result["totalBytes"]):
            raise ValueError()
        return result
    except (ValueError, TypeError, KeyError):
        raise QaDeviceFailure("Read-only database verification failed: creation/upload/proposal must each occur once.") from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True, help="Exact adb device serial; there is no default device.")
    parser.add_argument("--adb", help="Optional path to the Android SDK adb executable.")
    parser.add_argument("--aapt2", help="Optional path to the Android SDK aapt2 executable.")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", args.serial):
        parser.error("Invalid explicit adb serial.")
    log = None
    stage = "setup"
    backend_stage = None
    try:
        user = read_alice()
        logs = STATE / "device-tests"
        logs.mkdir(mode=0o700, parents=True, exist_ok=True)
        name = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8] + ".log"
        log = CommandLog(logs / name, (user["username"], user["password"]))
        adb = executable(args.adb, "adb")
        aapt2 = executable(args.aapt2, "aapt2")
        verify_local_environment()
        apks = checked_apks(aapt2, log)
        stage = "device"
        prefix = [adb, "-s", args.serial]
        if log.run([*prefix, "get-state"], "Verify selected device").strip() != "device":
            raise QaDeviceFailure("The selected device is not ready.")
        sdk = device_number(prefix, log, ["getprop", "ro.build.version.sdk"], "Read selected Android SDK", minimum=26)
        user_id = current_user(prefix, log)
        for apk in apks:
            installed = log.run([*prefix, "install", "--user", str(user_id), "-r", str(apk)], "Install fixed QA APK", timeout=120)
            if not re.search(r"^Success\s*$", installed, re.MULTILINE):
                raise QaDeviceFailure("QA APK installation was not confirmed.")
        for application_id in (APP_ID, TEST_ID):
            packages = log.run([*prefix, "shell", "-T", "pm", "list", "packages", "--user", str(user_id), application_id],
                               "Verify QA installation for selected Android user")
            if "package:" + application_id not in packages.splitlines():
                raise QaDeviceFailure("A required QA package is missing for the selected Android user.")
        inventory = log.run([*prefix, "shell", "-T", "pm", "list", "instrumentation"], "Verify installed QA instrumentation")
        expected = f"instrumentation:{RUNNER} (target={APP_ID})"
        if expected not in inventory.splitlines():
            raise QaDeviceFailure("Installed QA instrumentation targets the wrong application.")
        stage = "local-network-permission"
        with temporary_local_network_permission(prefix, log, sdk, user_id):
            stage = "instrumentation"
            output = log.run([*prefix, "shell", "-T", "sh"], "Run guarded live QA integration",
                             input_text=instrument_command(user["username"], user["password"], user_id), timeout=300)
            # Capture the last reported fixed stage before validating, so a failing stage survives
            # any later permission-restoration failure in the context-manager finally.
            backend_stage = reported_stage(output)
            receipt = parse_instrumentation(output, user["publicId"])
            stage = "database-oracle"
            oracle = database_oracle(receipt)
            log.write("Read-only QA oracle: " + json.dumps(oracle, separators=(",", ":")))
            stage = "local-network-permission-restoration"
        summary = {"status": "passed", "tests": 1, "creationCount": oracle["creationCount"],
                   "proposalCount": oracle["proposalCount"], "uploadedBytes": oracle["totalBytes"],
                   "log": str(log.path.relative_to(ANDROID))}
        print(json.dumps(summary, separators=(",", ":")))
        return 0
    except KeyboardInterrupt:
        message, code = "Interrupted; the selected QA device may still be finishing the test.", 130
    except QaDeviceFailure as error:
        message, code = str(error), 1
        # The error's own fixed stage (for example the instrumentation stage) wins over any
        # coarse stage variable that later cleanup might otherwise advance.
        if error.backend_stage is not None:
            backend_stage = error.backend_stage
    except Exception:
        # Never format subprocess exceptions, arguments, environment or malformed credential contents.
        message, code = "QA prerequisite or verification failed; no production fallback was attempted.", 1
    finally:
        if log:
            log.close()
    result = {"status": "failed", "stage": stage, "message": message}
    if backend_stage in BACKEND_STAGES:
        result["backendStage"] = backend_stage
    if log:
        result["log"] = str(log.path.relative_to(ANDROID))
    print(json.dumps(result, separators=(",", ":")))
    return code


if __name__ == "__main__":
    sys.exit(main())
