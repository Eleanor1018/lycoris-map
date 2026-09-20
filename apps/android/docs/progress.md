# Android implementation and acceptance evidence

Implementation baseline: `c139926`. Android branch: `feat/android-native`; visible worktree: `/Users/nora/lycoris-map-android`. Android Studio opens `apps/android` in that worktree. The iOS branch remains in `/Users/nora/lycoris-map` and is not switched during Android development. Both native source folders retain their monorepo paths, `apps/ios` and `apps/android`.

This is an implementation and test record, not a declaration that every A0–A7 acceptance gate has passed. The remaining visual and physical-device checks are explicit below.

| Stage | Implemented | Verified locally | Still to accept |
|---|---|---|---|
| A0 | Kotlin/Compose project, isolated variants, persistent MapLibre renderer, guarded QA stack | QA and R8 release/preview builds, installation on no-GMS AOSP API 36; native map lifecycle test | Figma/actual OSM pixels via Computer Use; physical provider calibration |
| A1 | Android Figma tokens/assets, three primary tabs, three-state nonmodal sheet, natural short-content height | Initial nearby cards, drag-to-close, nested scrolling, short-window/large-font constraints; real IME and Activity rotation on Pixel 10 Pro API 37.2 | Visual comparison, tablet/three-button navigation and TalkBack |
| A2 | Public viewport/search/nearby/detail, category-aware clustering, R2 image routing, request coverage/cancellation | JVM API races, 9 clustering cases, 5 viewport policy cases; real Activity browse/search smoke | Long real-map gesture session and pixel rendering after external return |
| A3 | Foreground location, approximate/denied states, compass accuracy/rotation, one-time initial recenter | 8 pure device-policy cases; no-GMS application starts | Actual permission dialogs, GPS/heading on physical devices |
| A4 | Accounts/profile/avatar/password, encrypted origin-bound session, favorites/my places, deferred login actions | Account races/restore/401/favorites tests; form tests; actual isolated Rust login/session restore/favorite add and remove | UI account switching and Photo Picker; process-cold full UI flows |
| A5 | Room drafts, ordered field persistence, native contribution form, sanitized photos, resumable WorkManager uploads | 21 protocol/media JVM cases; 9 persistence/image/worker device cases; guarded real Rust create/upload with read-only SQL oracle | Photo Picker grants, genuine process death and real network/background restrictions |
| A6 | Language, single numeric radius, map source, on-device speech, native navigation/share, strict links | Speech state-machine cases and unavailable-service UI; settings/back flow; valid/invalid cold/hot Activity intents | Real speech service, navigation app chooser/return, OS-verified App Links |
| A7 | Reproducible CI workflow, optimized installable preview, unsigned release, QA reproduction and release checklist | Local and remote builds/tests, R8 and packaging validation; see command record below | Computer Use visual acceptance, optimized runtime profile and named physical-device matrix |

## Design baseline

Figma Android page `32:2454`: default middle `53:580`, expanded `53:724`, settings `53:1379`, detail `68:2231`. The 13 exact SVG exports and their provenance/SHA-256 are recorded in `figma-assets.json`. App icon is the existing project-owned iOS artwork. Roboto/Noto and native Material 3 complete the Android screens without dedicated auth/contribution frames.

Search uses 8 dp horizontal margin, 60 dp minimum height and 22 dp corner radius; primary panel rows use 30 dp horizontal margin; visible primary navigation is at least 64 dp plus system inset. Middle height is measured from the nearby header/cards. Short detail content wraps and keeps 22 dp internal bottom padding. A single bounded LazyColumn preserves natural height while composing only viewport-adjacent point rows. The app does not adopt Web's 11 px margin globally.

The persistent map/panel navigation is an explicit `SavedStateHandle` state machine rather than a separate Compose Navigation stack. Cold/hot Activity tests cover intent delivery and restoration; they do not establish a verified website association or a process-cold launch.

## Local evidence, 2026-09-20

Environment: dedicated Android 16/API 36 AOSP ARM64 emulator without Play services, 824 × 1850 px at 320 dpi (412 × 925 dp); software-rendered host. JBR 25.0.3, Gradle 9.4.1, AGP 9.2.1, compile/target 37, min 26. The host also runs development tools, so emulator timings are not hardware performance claims.

- `:app:testQaUnitTest`: 124 cases passed with no failures/errors/skips on the final source build.
- QA lint, QA app, QA instrumentation, R8-optimized preview and unsigned release all passed after the lazy-list integration (`:app:testQaUnitTest :app:lintQa :app:assemblePreview :app:assembleRelease :app:connectedQaAndroidTest`, 2m54s).
- Device XML records 31 tests: 30 passed, zero failures/errors and one expected skip for the opt-in server test. Coverage includes native account forms, Room reopen/worker/photo recovery, sheet gestures, Activity settings/search/account flows, map lifecycle, and 5,000 lazy rows with bounded composition and the last row reachable. The real-backend test passed separately through the opt-in runner.
- Actual Android → guarded gateway → isolated Rust/Postgres integration passed: encrypted session restore; favorite add/refresh/remove; repeated point creation; multi-chunk image upload with duplicate chunk/start/complete requests. Read-only SQL verified exactly one new marker and one image proposal, completed receipt linkage, 763045 received bytes and zero retained staged bytes.
- 29 Python guard/runner tests passed. `qa_device_test.py --serial <explicit QA device>` reproduces the live integration and database oracle without exposing credentials in terminal logs.
- Preview/release APK ZIP alignment checks pass with `zipalign -c -P 16 4`; packaged ARM64/x86_64 ELF PT_LOAD alignment is 16384. The additional API 37 ARM64 emulator reports 16384-byte pages; after DataStore 1.2.1, both QA and preview report `pageSizeCompat=0`. Native QA tests and the guarded backend/image integration passed; signed-release runtime acceptance is separate.
- Actionlint accepted the Android workflow. [GitHub Actions run 35489996913](https://github.com/Eleanor1018/lycoris-map/actions/runs/35489996913) passed on source commit `3edbd764a2e672d55aa6dad79087f99827f3383e`: JDK 17/Ubuntu 24.04, unit tests, lint, QA/preview/unsigned-release builds, ZIP alignment and AOSP API 36 x86_64 device tests. The real-backend test was the sole expected skip; local opt-in execution supplies its separate evidence. Test reports and APKs are attached to that run with 14-day retention. Subsequent documentation-only commits do not change the tested application source.

The compatibility build before the renderer replacement passed unit tests, QA lint and all four APK outputs in 1m50s. A new API 36 local suite passed 30 cases (one expected skip), and API 37 passed 29 (two expected skips). A later CI run exposed background map errors overwriting the speech fallback; this was fixed with action-notice priority and four deterministic regressions. Both live QA runners passed after Android 17 local-network permission handling. The first API 26 run then failed because the default MapLibre 13.6.1 artifact requires Vulkan. The dependency now uses the official same-version OpenGL ES artifact; the OpenGL candidate has since passed a real OSM viewport/background-return check on API 36 and the focused Pixel 10 Pro API 37.2/16 KB suite described below; its complete candidate matrix and API 26 CI result remain pending. See [the detailed compatibility record](compatibility-2026-09-20.md).

Defects found and fixed during testing include first-measurement expansion of the middle sheet, list fling incorrectly collapsing the sheet, MapLibre native updates resuming off the main thread, anonymous detail requests racing session restoration, a deferred bookmark toggling an existing favorite off, and stale draft completion overriding newer navigation. Delayed account restoration, return-page reload and deferred-draft navigation now have explicit state guards; these specific whole-UI races still require the extended device matrix.

## External limitations

- Computer Use has alternated between an unreadable Android Studio Running Devices floating window and a locked Mac. No native Figma screenshot comparison has been accepted yet. Android Studio is now open on the visible Android worktree; automated tests are not a substitute for a complete visual review.
- The earlier browser-only Tianditu key returned HTTP 403 / service code 301012 for a native WMTS request. The replacement key now loads official WMTS tiles through the native renderer; see the Tianditu follow-up below. Google remains disabled until an Android SDK key is configured.
- Physical GPS/compass, on-device recognition, navigation-app return, OEM background behavior, signed-release runtime and optimized performance measurements remain unverified.
- Local release signing is now available (see the signing follow-up below); app-store distribution and website `assetlinks.json` remain unconfigured. The `.preview` package uses a debug certificate and is for evaluation. CI release artifacts remain unsigned.

See [testing-qa.md](testing-qa.md) for the isolated environment and [release-checklist.md](release-checklist.md) for the full remaining acceptance matrix. No production records, server configuration or Web deployment were modified by these Android checks.

## OpenGL and Pixel 10 Pro follow-up

At the user's request, manual evaluation moved to the existing `Pixel_10_Pro` AVD, API 37.2 ARM64 with 16384-byte pages. The latest QA and optimized Preview packages are installed there; both report `pageSizeCompat=0`. Existing AVD data was retained.

- OpenGL QA/test/Preview/unsigned-release packaging, 124 JVM tests and QA lint passed before the final keyboard-return change. After the keyboard-return fix, QA/instrumentation/Preview rebuilt successfully and the final JVM/lint/unsigned-release rerun passed (1m17s).
- Pixel focused suite: 9 passes, zero failures, one explicit skip for the loaded-backend-detail test. It verifies real IME appearance and first-Back dismissal in search/login, reachable form actions, actual Activity rotation and retained camera/selection, merged sheet-anchor recovery, nested scroll ownership, and the native OpenGL renderer. This is not the complete candidate suite.
- The real OSM opt-in test passed on the no-GMS API 36 device: the visible center tile completed parsing, MapLibre reported fully drawn frames, and another fully drawn frame arrived after a genuine CREATED/RESUMED lifecycle round trip with the same camera. Production style, TLS and cache were unchanged. The test device temporarily used the host's existing HTTP proxy because its direct tile connection failed; that device setting was restored afterward.
- Actual tests found and fixed three additional defects: a geometry-induced sheet settle overwrote the expanded intent; Activity recreation reset panel height and re-centered an already selected detail; Back could close a secondary page while its keyboard was visible. The loaded-detail camera case remains explicit opt-in until its separate guarded-QA run.
- An old 16 KB compatibility dialog left by the previous package obscured the initial IME run. After the corrected package reported zero compatibility flags, restarting the dedicated test emulator removed that stale window; tests then exposed the actual Back defect above. No test timeout was increased or keyboard state forced to hide it.

Local evidence: `opengl-final-build.log`, `ime-fixed-build.log`, `pixel-focused.log`, `osm-live-systemproxy.log` under the ignored runtime directory. Computer Use can now see Pixel's real Preview permission dialog, but its floating-window focus issue prevents completed manual acceptance; docking is pending. No screenshots or synthetic tests are presented as completed Figma acceptance.

## Map-provider fixes and developer handoff

The Android worktree has been moved out of the Codex task directory to `/Users/nora/lycoris-map-android`, and Android Studio visibly shows that project on `feat/android-native`, with the `app` run configuration and Pixel 10 Pro selected. A temporary copy that had been placed into the iOS checkout during a misunderstanding was compared, all later edits preserved, and archived locally. The original iOS files and Git index were verified unchanged. No Git history merge or branch switch was performed in the iOS checkout.

The current candidate adds native Google Maps 20.0.0 alongside default OSM, shared geographic camera/markers/location/heading, guarded unavailable-provider selection, raster-load failure feedback and retry. Bookmarks heading now uses the same 30 dp content inset. Startup location and Android 17 QA-local-network requests run sequentially and persist their one-time/in-flight state across rotation; ordinary network and compass access need no separate prompt. Real Google rendering requires an Android key and remains unverified.

Before transfer, the reviewed source passed QA/test/Preview builds, QA lint and 129 JVM tests. The first Pixel runtime attempt was interrupted by an ADB disconnection before instrumentation started. The temporary device proxy was explicitly restored and checked as `null`; no runtime-test success is claimed for that attempt.

After transfer, the current QA package passed all 8 focused Pixel tests (14.627 seconds): four Google camera/padding value-object cases, three provider-selector cases, and native OpenGL lifecycle/background recovery. The selector tests do not create a GoogleMap or claim Google tiles rendered. The optimized Preview from the same source is installed on Pixel 10 Pro. The broader runtime attempt was interrupted by an ADB disconnect during its first case; its scoped local-network grant and device proxy were subsequently restored and checked, with original permission flags unchanged.

The final single-viewport OSM check also passed on Pixel 10 Pro (1 test, 4.168 seconds): center tile fetch/parse, fully rendered native frames and a background-return camera check. It used only the existing host proxy for the test, then restored the device proxy to `null` and QA local-network permission to its original denial/flags. Direct OSM HTTPS from the host timed out, whereas the proxy returned HTTP 200. This proves the Pixel renderer can draw OSM with network reachability; it does not claim the direct connection or Google tiles were repaired.

Android Studio was re-synced after relocation and opened the current `HomeScreen.kt`; the toolbar shows `feat/android-native`, run configuration `app`, and Pixel 10 Pro. Its selected build variant is still `debug` (Lycoris Dev), while the reviewed package already installed on the Pixel is `preview` (Lycoris Preview). These are separate app IDs; running the default configuration does not update Preview.

Before publishing these fixes, the relocated Android project passed `:app:testQaUnitTest` (129 tests, zero failures/errors) and `:app:lintQa` again. No application source changed after the reviewed QA/Preview builds and focused Pixel checks described above. The IDE-generated local JDK 25 daemon pin was archived outside the repository; the existing CI JDK 17 setup remains unchanged.

## Search settings and Positions alignment

Android Settings now follows the iOS ordering and includes Search Type and About Lycoris Maps. Search Type saves All / Accessible Toilets / Nursing Rooms / Medical Institutions in DataStore and filters keyword/voice results using the latest selection, including in-flight responses. All retains custom categories; explicit Nearby, viewport and bookmark results keep their existing behavior. About displays the installed version and shared introduction. The expanded Explore Positions heading now matches the list's 30 dp left inset.

- `:app:testQaUnitTest :app:lintQa :app:assembleQa :app:assembleQaAndroidTest :app:assemblePreview` passed in 1m58s: 131 JVM tests, zero failures/errors/skips. New repository cases cover changing types without refetching, preserving other lists, latest-type filtering during a request and request-failure state.
- Two focused Pixel 10 Pro API 37.2 instrumentation cases passed in 16.581s: primary navigation after Activity recreation, and Search Type selection/restoration plus About version/introduction/dismissal. The test restores its original QA preference. Activity recreation is not a process-cold persistence test.
- The updated QA and optimized Preview packages are installed. Android Studio also successfully built, installed and launched the default debug variant (Lycoris Dev) from the visible worktree. Manual screenshots confirm all five Settings rows in Dev. The Search Type popup and selection were also observed, but the active package was not established for that earlier interaction, so it is not claimed as a Dev cold-start persistence check.
- Computer Use subsequently returned `noWindowsAvailable` for coordinate clicks while still providing Android Studio screenshots. The remaining manual About/expanded Positions checks could not be completed in this session; automated functional checks above passed. No full visual-acceptance claim is made.

Local command evidence is in `settings-followup-build.log` and `settings-followup-pixel.log` under the ignored runtime directory. No emulator data was cleared; device proxy, production records and server configuration were unchanged.

## OSM Worker and native Tencent Maps

Android now uses the Web deployment's `https://lycoris-map.com/tiles/osm/{z}/{x}/{y}.png` route. A direct host request with proxies disabled returned HTTP 200, a 256×256 PNG and `X-Lycoris-Tile-Source: osm-worker` / cache HIT. Existing disk caching and visible OSM attribution remain in place.

Tencent uses its official native Android SDK, with shared Figma marker assets, category clusters, foreground location/heading and WGS84 application state. GCJ-02 conversion is restricted to the provider boundary. Switching providers retains camera position/scale. Chinese defaults to Tencent when configured, English to OSM; only explicit choices write the provider key, so manual choices survive language changes and restarts. Existing saved choices are preserved. A separate first-use privacy choice gates SDK initialization. The key is in ignored local configuration; the workflow can read `LYCORIS_TENCENT_MAPS_API_KEY`, but this follow-up did not create that GitHub repository secret.

- Final build: `:app:testQaUnitTest :app:lintQa :app:assembleQa :app:assembleQaAndroidTest :app:assemblePreview :app:assembleDebug :app:assembleRelease` passed in 4m57s. All 134 JVM tests passed with no failures/errors/skips.
- Final Pixel 10 Pro API 37.2 run: 10 focused instrumentation cases passed in 184.428s. These include real Tencent SDK authentication/loading, a visible synthetic marker with geographic-coordinate checks, background return, Tencent → offline OSM → Tencent switching, repeated camera conversion, provider-selector availability, and the real Worker-backed OSM viewport/background-render test.
- The emulator proxy remained `null`; no network permissions or device proxy were changed for these online checks. Tencent used a synthetic Shanghai viewport, no account records or live device fix. OSM's native loader reported fetched/parsed center tiles and fully rendered frames; cache-origin semantics remain documented in the test.
- Debug, QA and optimized Preview were installed on Pixel without clearing data. Dev and Preview report `pageSizeCompat=0`. All ten packaged 64-bit libraries in each checked APK have ELF load alignment of at least 16 KB; Preview ZIP alignment passes. Tencent's official lite foundation avoids the optional full-foundation Bugly x86_64 binary with 4 KB alignment.
- Android Studio was synced in the visible worktree and launched the updated Dev build. Computer Use confirmed rendered OSM and the enabled Tencent option alongside OSM and unavailable Google Maps. Dev's existing provider/language preferences and Tencent privacy choice were left unchanged. Tencent's full visual comparison and physical-device heading remain separate from the automated SDK evidence above.

Evidence: `tencent-verified-build.log`, `tencent-pixel-final.log` in the ignored runtime directory. No Web/iOS source, server deployment or production data was changed.

## CI soft-keyboard fixture

Remote run [35503823643](https://github.com/Eleanor1018/lycoris-map/actions/runs/35503823643) passed unit tests, lint, all APK builds and release ZIP alignment, but failed the real IME test on API 36. Its diagnostics reported a hardware keyboard, `showImeWithHardKeyboard=0` and zero IME bottom inset despite the focused text editor. The workflow now enables and checks `show_ime_with_hard_keyboard` only on its disposable API 36 and API 26 AVDs. The existing real-touch, keyboard-inset, Back handling and button-reachability assertions remain unchanged; no local or physical-device keyboard setting is changed. A new remote run is required to verify this fixture correction.

## Local release signing

A new owner-controlled release key was created outside the repository on 2026-09-20: RSA 3072, PKCS12, 30-year validity, randomly generated password, directory mode 700 and file modes 600. The public certificate and exact map-service registration values are recorded in [signing.md](signing.md). Ignored `local.properties` contains only the external credentials-file path. The private key and passwords were not uploaded to GitHub; an off-device owner backup remains necessary.

`signingReport`, `assembleRelease` and `bundleRelease` passed in 1m10s. `apksigner verify --verbose --print-certs` verified the resulting APK with the intended release certificate; its package is `com.lycoris.maps`, it is not debuggable, and 16 KB ZIP alignment passes. The AAB JAR signature verifies with the same certificate. Debug/QA/Preview retain the original debug certificate. Five isolated Gradle configuration checks passed: absent configuration stays unsigned; an explicitly blank path, missing credentials file, partial fields or missing keystore fails configuration. Those checks did not change developer-device settings.

This establishes local signing and artifact verification, not a store release or signed-release runtime acceptance. CI continues building unsigned release artifacts without private signing credentials. Build evidence is `release-signing-build.log` in the ignored runtime directory.

## Tianditu native raster maps, 2026-09-21

The supplied replacement Tianditu key is configured only in ignored local secrets. Android uses the existing native MapLibre renderer with Tianditu's HTTPS WMTS vector base and Chinese label layers, visible attribution and shared geographic overlays. Official service capabilities declare 256 px Web Mercator tiles, vector levels 1–18 and label levels 1–19. Ordinary native requests returned HTTP 200 PNGs for both layers, without browser-header impersonation. This verifies WMTS access, not authentication of Tianditu's separate Android SDK.

The existing map-source menu now includes Tianditu when configured. Chinese still defaults to configured Tencent and English to OSM; an explicit available provider choice wins across language changes. `LYCORIS_TIANDITU_MAPS_API_KEY` is wired into the workflow as an optional Actions secret, but was not uploaded to GitHub in this task. Repository sources and documentation contain no actual map key.

The new native test exposed a cached-style timing defect: a style could finish reloading before Compose observed `ready=false`, leaving point and location overlays detached. A monotonically increasing style revision now triggers overlay reattachment for every completed style load. The original rendered-marker and location assertions pass with this fix.

- Final QA/Dev build and lint passed; all 137 JVM tests passed with zero failures, errors or skips. Optimized Preview and signed Release APK builds also passed.
- Pixel 10 Pro API 37.2 passed all 9 selected device tests in 73.517 seconds: both live raster provider tests and seven map-source selector cases. Tianditu checks fetched/parsed center tiles from both sources, fully rendered frames, the production load callback, a synthetic geographic marker and location dot, marker touch selection, background return, and Tianditu → OSM → Tianditu camera retention. These checks do not claim physical-device GPS/compass acceptance.
- The device proxy remained `null`; no production records, device data, permissions or network settings were changed. QA, Dev and optimized Preview were updated without clearing app data. Dev and Preview report `pageSizeCompat=0`; Preview and Release pass 16 KB ZIP alignment. The Release APK signature matches the certificate in `signing.md`.
- Android Studio was synced on the visible Android worktree. Computer Use confirmed the enabled Tianditu option and rendered Shanghai roads, Chinese labels and existing place markers in Dev after selecting a public search result. Dev is left on that Tianditu detail view for review; its manual provider selection is now Tianditu. Preview is installed but not separately claimed as manually reviewed.
- Earlier CI run [35505259363](https://github.com/Eleanor1018/lycoris-map/actions/runs/35505259363) on the preceding signing commit passed its main/API 36 job, but API 26 still failed two rotation/IME cases. Those compatibility failures remain open; the focused Pixel pass is not a complete CI-matrix pass.

Evidence: `tianditu-qa-verified.log`, `tianditu-optimized-verified.log` and `tianditu-pixel-verified.log` in the ignored runtime directory. No Web/iOS source, server deployment or production data was modified.
