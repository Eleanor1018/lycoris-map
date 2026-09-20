# Isolated Android functional testing

The native `qa` build talks only to the local test gateway at `http://10.0.2.2:18187/`. The emulator maps `10.0.2.2` to the host loopback. The gateway forwards only to `127.0.0.1:18186`, where a separate Rust backend serves a synthetic database. These endpoints have no production fallback.

## Reproduce the backend

Prerequisites: Python 3, a local Unix-socket Docker engine with Compose, and enough memory to build the Rust backend. Select the intended local Docker context before starting. The Compose project is `lycoris-android-qa`; its database, Redis, uploads and containers are independently named. PostgreSQL and Redis have no host-published ports. Only the backend binds host loopback port 18186.

From the repository root:

```sh
python3 apps/android/scripts/qa_setup.py init
python3 apps/android/scripts/qa_setup.py start
python3 apps/android/scripts/qa_gateway.py
```

The last command runs the gateway in the foreground on loopback port 18187. Keep it running during device tests. `start` uses the existing locked Rust Dockerfile with one Cargo build job, applies migrations only to `lycoris_android_qa`, starts dependencies, and creates or reuses three owned synthetic accounts and five fixture markers. It never deletes other users or points, resets existing passwords, restores production data or edits another database.

For networks requiring a build proxy, set `ANDROID_QA_BUILD_PROXY` before the first `init`, or update that value in the private `app/build/qa/backend.env`. Container builds need a proxy address reachable from the Docker VM, rather than the host's own `127.0.0.1`. Do not use a production database URL; this setup intentionally provides no URL override.

All generated configuration, random synthetic passwords and fixture IDs are stored in `apps/android/app/build/qa/`, which is ignored as build output. `credentials.json` contains fixture-owner, Alice and Bob accounts for login and account-switch tests. Do not copy these credentials into application code or logs. Keep this directory while reusing its Docker volumes. If only account credentials are lost, `init` creates fresh accounts rather than changing existing passwords. If `backend.env` is lost too, restore that local configuration before reusing the database volume; setup does not reset its password or discard its contents.

To check an already running environment:

```sh
python3 apps/android/scripts/qa_setup.py verify
python3 apps/android/scripts/qa_setup.py seed
```

`seed` is repeatable using the persisted credentials and fixed client request IDs. It only approves the exact fixture marker ID, owner public ID and request key that it created. It does not approve arbitrary contributions made during application tests.

## Native preflight protocol

Before any non-GET/HEAD/OPTIONS request—including login or registration—the QA client must verify its exact local origin and obtain:

```http
GET /__lycoris_qa__/manifest
```

```json
{
  "testEnvironment": "lycoris-android-synthetic-v1",
  "protocolVersion": 1,
  "instanceNonce": "<64 lowercase hexadecimal characters>",
  "upstream": "http://127.0.0.1:18186/",
  "sentinel": {
    "markerId": 1,
    "title": "Android QA Environment Sentinel v1",
    "description": "Synthetic Android QA only. Never production data.",
    "ownerPublicId": "<synthetic fixture owner UUID>",
    "clientRequestId": "android-qa-sentinel-v1"
  }
}
```

The marker ID is an example; consume the verified manifest, since a reused database can assign a different ID. A response must contain `X-Lycoris-Test-Environment: lycoris-android-synthetic-v1`. The nonce is generated for each gateway process, so it becomes stale after a gateway restart.

Echo these headers on mutations:

```http
X-Lycoris-Test-Environment: lycoris-android-synthetic-v1
X-Lycoris-Test-Nonce: <instanceNonce>
```

The gateway checks the sentinel's exact title, description, owner, client request ID, public flag and approved status before returning a manifest and again before forwarding each mutation. Missing or stale headers return 403 without forwarding. A missing or mismatched sentinel returns 503. Redirects and absolute external request URLs are rejected. Cookies and empty 200 mutation responses are preserved. The manifest is an accidental-environment protection mechanism for local QA, not an authentication mechanism for a public service.

## Fixtures and checks

Four visible points around WGS84 `31.2304, 121.4737` cover accessible toilets, nursing rooms, medical institutions and other locations. The sentinel is at `-70, 0`, outside the UI fixture area. `fixtures.json` records actual IDs. Images, contribution draft state and permissions are exercised by dedicated app tests rather than pre-populated with production content.

Run gateway isolation regression tests without a running backend:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s apps/android/scripts -p 'qa_gateway_test.py' -v
```

On 2026-09-20, all seven guard tests passed. A real local-backend HTTP smoke test also passed manifest validation, missing-header write rejection, session login, favorite add/read/remove with empty mutation responses, and logout. The favorite was removed after verification, restoring the synthetic account's prior favorite list. These checks do not establish Android UI, real sensor, microphone or physical-device behavior.

Use `docker compose --env-file apps/android/app/build/qa/backend.env -f apps/android/scripts/qa.compose.yml stop` when the test stack is no longer needed. This preserves its synthetic database and uploads for later sessions.
