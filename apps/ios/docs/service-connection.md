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

## 2026-09-20 — empty-map regression recheck

The public viewport and search paths, query names and JSON DTO still match Rust.
Bounded Shanghai reads with curl, an iOS-style User-Agent and Safari's User-Agent
returned HTTP 200: 40 viewport records and 37 search records. All response fields
matched `Marker`. Python urllib's default signature still receives an edge 403;
this is not the native app's request signature and no Cloudflare setting changed.

The client was preventing viewport publication and mainland pin projection while
waiting for a public-landmark lookup. The working display space now exists before
that lookup, and failure keeps browsing active. See `coordinate-alignment.md`.

A temporary **read-only Debug UI smoke test against the real HTTPS service**
passed on iPhone 17 / iOS 26.5 Simulator: real viewport pins appeared before any
search, searching Shanghai returned rows, and opening one displayed its detail
and pin. Its two screenshots were inspected. No account or marker was created or
edited. The live probe was removed from the regular isolated Test suite afterward.

The deterministic regression run passed 37 unit tests and three UI flows,
including failed calibration, location following, dragging the collapsed search
row/padding, ordinary taps, keyboard input and expanded scrolling. Debug and
Release builds passed. The panel now uses SwiftUI's native
[`glassEffect`](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)
with the same regular material as the map tools, retaining a solid Reduce
Transparency fallback.
