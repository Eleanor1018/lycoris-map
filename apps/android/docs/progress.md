# Android implementation and acceptance evidence

Base: `c139926` (main with merged iOS and Web interaction fixes). Branch: `feat/android-native`; isolated worktree, no changes to the active iOS checkout.

This is an implementation and test record, not a declaration that every A0–A7 acceptance gate has passed. The remaining visual and physical-device checks are explicit below.

| Stage | Implemented | Verified locally | Still to accept |
|---|---|---|---|
| A0 | Kotlin/Compose project, isolated variants, persistent MapLibre renderer, guarded QA stack | QA and R8 release/preview builds, installation on no-GMS AOSP API 36; native map lifecycle test | Figma/actual OSM pixels via Computer Use; physical provider calibration |
| A1 | Android Figma tokens/assets, three primary tabs, three-state nonmodal sheet, natural short-content height | Initial nearby cards, drag-to-close, nested scrolling, short-window/large-font constraints | Visual comparison, actual IME/rotation/tablet/three-button navigation and TalkBack |
| A2 | Public viewport/search/nearby/detail, category-aware clustering, R2 image routing, request coverage/cancellation | JVM API races, 9 clustering cases, 5 viewport policy cases; real Activity browse/search smoke | Long real-map gesture session and pixel rendering after external return |
| A3 | Foreground location, approximate/denied states, compass accuracy/rotation, one-time initial recenter | 8 pure device-policy cases; no-GMS application starts | Actual permission dialogs, GPS/heading on physical devices |
| A4 | Accounts/profile/avatar/password, encrypted origin-bound session, favorites/my places, deferred login actions | Account races/restore/401/favorites tests; form tests; actual isolated Rust login/session restore/favorite add and remove | UI account switching and Photo Picker; process-cold full UI flows |
| A5 | Room drafts, ordered field persistence, native contribution form, sanitized photos, resumable WorkManager uploads | 21 protocol/media JVM cases; 9 persistence/image/worker device cases; guarded real Rust create/upload with read-only SQL oracle | Photo Picker grants, genuine process death and real network/background restrictions |
| A6 | Language, single numeric radius, map source, on-device speech, native navigation/share, strict links | Speech state-machine cases and unavailable-service UI; settings/back flow; valid/invalid cold/hot Activity intents | Real speech service, navigation app chooser/return, OS-verified App Links |
| A7 | Reproducible CI workflow, optimized installable preview, unsigned release, QA reproduction and release checklist | Local builds/tests, R8 and packaging validation; see command record below | Remote CI, Computer Use visual acceptance, optimized runtime profile and named physical-device matrix |

## Design baseline

Figma Android page `32:2454`: default middle `53:580`, expanded `53:724`, settings `53:1379`, detail `68:2231`. The 13 exact SVG exports and their provenance/SHA-256 are recorded in `figma-assets.json`. App icon is the existing project-owned iOS artwork. Roboto/Noto and native Material 3 complete the Android screens without dedicated auth/contribution frames.

Search uses 8 dp horizontal margin, 60 dp minimum height and 22 dp corner radius; primary panel rows use 30 dp horizontal margin; visible primary navigation is at least 64 dp plus system inset. Middle height is measured from the nearby header/cards. Short detail content wraps and keeps 22 dp internal bottom padding. A single bounded LazyColumn preserves natural height while composing only viewport-adjacent point rows. The app does not adopt Web's 11 px margin globally.

The persistent map/panel navigation is an explicit `SavedStateHandle` state machine rather than a separate Compose Navigation stack. Cold/hot Activity tests cover intent delivery and restoration; they do not establish a verified website association or a process-cold launch.

## Local evidence, 2026-09-20

Environment: dedicated Android 16/API 36 AOSP ARM64 emulator without Play services, 824 × 1850 px at 320 dpi (412 × 925 dp); software-rendered host. JBR 25.0.3, Gradle 9.4.1, AGP 9.2.1, compile/target 37, min 26. The host also runs development tools, so emulator timings are not hardware performance claims.

- `:app:testQaUnitTest`: 120 cases passed with no failures/errors/skips on the final source build.
- QA lint, QA app, QA instrumentation, R8-optimized preview and unsigned release all passed after the lazy-list integration (`:app:testQaUnitTest :app:lintQa :app:assemblePreview :app:assembleRelease :app:connectedQaAndroidTest`, 2m54s).
- Device XML records 31 tests: 30 passed, zero failures/errors and one expected skip for the opt-in server test. Coverage includes native account forms, Room reopen/worker/photo recovery, sheet gestures, Activity settings/search/account flows, map lifecycle, and 5,000 lazy rows with bounded composition and the last row reachable. The real-backend test passed separately through the opt-in runner.
- Actual Android → guarded gateway → isolated Rust/Postgres integration passed: encrypted session restore; favorite add/refresh/remove; repeated point creation; multi-chunk image upload with duplicate chunk/start/complete requests. Read-only SQL verified exactly one new marker and one image proposal, completed receipt linkage, 763045 received bytes and zero retained staged bytes.
- 14 Python guard/runner tests passed. `qa_device_test.py --serial <explicit QA device>` reproduces the live integration and database oracle without exposing credentials in terminal logs.
- Preview/release APK ZIP alignment checks pass with `zipalign -c -P 16 4`; packaged ARM64/x86_64 ELF PT_LOAD alignment is 16384. The current emulator is not proof of a 16 KB runtime.
- Actionlint accepted the Android workflow. Remote CI execution must be recorded after push; a local check does not stand in for it.

Defects found and fixed during testing include first-measurement expansion of the middle sheet, list fling incorrectly collapsing the sheet, MapLibre native updates resuming off the main thread, anonymous detail requests racing session restoration, a deferred bookmark toggling an existing favorite off, and stale draft completion overriding newer navigation. Delayed account restoration, return-page reload and deferred-draft navigation now have explicit state guards; these specific whole-UI races still require the extended device matrix.

## External limitations

- Computer Use has alternated between an unreadable Android Studio Running Devices floating window and a locked Mac. No native Figma screenshot comparison has been accepted yet. A pending user request asks for unlock/docking; screenshots or unit tests are not substituted for this check.
- The browser-only Tianditu key returned HTTP 403 / service code 301012 for a native WMTS request. OSM remains available; no browser-header impersonation, embedded key or nonfunctional Google option is shipped. A native-authorized key is pending.
- Physical GPS/compass, on-device recognition, navigation-app return, OEM background behavior, actual 16 KB runtime and optimized performance measurements remain unverified.
- Release signing, app-store distribution and website `assetlinks.json` are not configured. The `.preview` package uses a debug certificate and is for evaluation. Release is unsigned.

See [testing-qa.md](testing-qa.md) for the isolated environment and [release-checklist.md](release-checklist.md) for the full remaining acceptance matrix. No production records, server configuration or Web deployment were modified by these Android checks.
