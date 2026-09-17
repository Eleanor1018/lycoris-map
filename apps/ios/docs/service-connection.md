# Live service connection — 2026-09-17

The user supplied `https://api.lycoris-map.com` as the new backend. Normal Xcode Run (Debug) and Release now inherit this URL from `Config/Base.xcconfig`. The public marker client, account client and media paths already share the bundled service origin; no transport or DTO rewrite was required.

## Observed on the live service

- DNS and TLS resolved successfully through Cloudflare.
- A native Foundation URLSession request to `/health/ready` returned 200 with PostgreSQL and Redis both `ok`.
- Unauthenticated `/api/me` returned the expected 401 rather than an edge challenge.
- Public search for Shanghai returned 37 real records at inspection time.
- Computer Use on iPhone 17 Pro queried the public coordinate of marker 234, opened the Shanghai Yuehui Plaza result, and displayed its title, hours, description, real photo and map annotations. The app was built by Xcode with the HTTPS address verified in its generated Info.plist.

Python urllib's default client signature received Cloudflare 1010. Native URLSession, curl and the actual iOS app succeeded. Cloudflare's [Browser Integrity Check documentation](https://developers.cloudflare.com/waf/tools/browser-integrity-check/) describes its handling of nonstandard user agents. No Cloudflare configuration or security setting was changed.

Live checks were read-only and anonymous. A successful real-account login, private data, contributions and other authenticated writes were not exercised on this service. The existing account/contribution contract matches the checked-in Rust backend; successful account writes remain subject to a real-account acceptance run. No new account, test place or photo was uploaded to the live service.

## Local test isolation

The shared scheme's Test action uses the new **Test** configuration. All four project/target configuration lists include it. The app uses `Config/Test.xcconfig`, which fixes the service to `http://127.0.0.1:8080` and deliberately excludes `Local.xcconfig`. Cold deep links therefore still reach the synthetic local service. Existing fixture preflights are retained.

All six UI suites inherit `LocalBackendTestCase`. Its `setUpWithError` skips fixture tests when they are compiled outside Test. This was verified by explicitly running the account-write test under Debug: it skipped before launching the fixture flow.

## Validation

- Test configuration: 5 configuration tests and 2 local UI flows passed (search/detail and cold/warm place links).
- Debug configuration: 5 configuration tests passed; the selected account-write UI flow was intentionally skipped by the isolation guard.
- Release simulator build succeeded. Its generated Info.plist contains `https://api.lycoris-map.com` and no ATS exceptions.
- Xcode Debug app and simulator public-place/photo behavior were checked with Computer Use.

Local logs: `/tmp/lycoris-ios-production-config-test.log`, `/tmp/lycoris-ios-production-guard.log`, `/tmp/lycoris-ios-production-release.log`. Physical-device signing, distribution and Universal Links were not part of this connection change.
