# Android release checklist

This checklist records release gates, not a release approval. Record the tested commit, APK SHA-256, device/OS, result and evidence for each completed item. Current implementation progress and local evidence are in [progress.md](progress.md); isolated backend setup is in [testing-qa.md](testing-qa.md).

## Automated checks

The [Android workflow](../../../.github/workflows/android.yml) runs only for Android/workflow changes or a manual dispatch. It uses a read-only repository token, never signs or deploys an application, and does not deploy the Web frontend or backend.

From `apps/android`, the corresponding commands are:

```sh
./gradlew --no-daemon --max-workers=2 :app:testQaUnitTest :app:lintQa
./gradlew --no-daemon --max-workers=2 :app:assembleQa :app:assemblePreview :app:assembleRelease :app:assembleQaAndroidTest
./gradlew --no-daemon --max-workers=2 :app:connectedQaAndroidTest
```

The last command requires an attached test device. CI uses API 36 `default` / `x86_64` AOSP without Google Play services. Instrumented tests exercise the real QA Activity, native map lifecycle, forms, panel gestures and local Room/Worker/image fixtures. UI smoke tests do not depend on successful tile or QA API requests. The real Rust integration test is explicitly opt-in and skips without synthetic credentials; CI does not start that backend or use production accounts. JVM tests use local fixtures/MockWebServer. Passing these checks does not replace visual or physical-device acceptance.

The separate `api26` job adds minimum-SDK coverage on AOSP API 26. It downloads the QA and instrumentation APKs built by `checks`, verifies their artifact digest, records APK SHA-256 hashes, and runs the same test package through `adb shell am instrument`. It does not rebuild with Gradle/R8, use a preview/release APK, or supply backend credentials. The job requires a nonempty successful runner summary and final completion code; a successful `adb` process alone cannot make a failing test run pass. Raw instrumentation output and emulator logcat are retained in `android-api26-results`. This new job still requires its first successful remote run.

The preview APK is installable with the debug certificate and runs the same R8 optimization as release, with shell profiling enabled. It uses a separate `.preview` application ID and real HTTPS endpoints. It supports local performance and browsing checks, but must not be distributed as a production-signed release.

- [x] The workflow passed on implementation commit `3edbd76`: [run 35489996913](https://github.com/Eleanor1018/lycoris-map/actions/runs/35489996913). Retain a new run for any later application-source changes; this is not a signed release approval.
- [x] Local XML: 124 JVM tests and 30 passing device tests, with only the opt-in backend case skipped. That backend case passed separately against guarded Rust/Postgres. Remote CI logs confirm the same expected skip and no test failures; lint has no errors (dependency-upgrade/style warnings remain).
- [ ] The new API 26 job passes on the candidate commit. Record its run URL, APK hashes and expected opt-in backend skip; the earlier API 36 run does not satisfy this gate.
- [ ] Verify the OpenGL artifact replacement on API 26, API 36 and the API 37 16 KB environment, including the native renderer assertion, merged manifest and packaged alignment. The original Vulkan artifact failed native startup on API 26; earlier runtime results do not satisfy this candidate's gate.
- [ ] Install and open the resulting QA APK; verify its application ID is `com.lycoris.maps.qa`.
- [ ] Review release R8 output and test a correctly signed release build. CI's `app-release-unsigned.apk` is an unsigned build artifact, not an installable store release.
- [ ] Retain release APK/AAB hashes, version code, mapping file and dependency/toolchain versions with the release record.

CI action releases were checked against their official repositories on 2026-09-20 and pinned to full commit SHAs: [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-java v6.0.1](https://github.com/actions/setup-java/releases/tag/v6.0.1), [setup-gradle v6.3.0](https://github.com/gradle/actions/releases/tag/v6.3.0), [android-emulator-runner v2.38.0](https://github.com/ReactiveCircus/android-emulator-runner/releases/tag/v2.38.0), and [upload-artifact v7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1). JDK 17, Gradle 9.4.1 and Build Tools 36.0.0 follow the [AGP 9.2 compatibility table](https://developer.android.com/build/releases/agp-9-2-0-release-notes). The compile platform package is `platforms;android-37.0`.

The API 26 job additionally pins [download-artifact v8.0.1](https://github.com/actions/download-artifact/releases/tag/v8.0.1). Google's [official AOSP system-image metadata](https://dl.google.com/android/repository/sys-img/android/sys-img2-3.xml), checked on 2026-09-20, lists `system-images;android-26;default;x86_64`: revision 1, archive `x86_64-26_r01.zip`, 474,178,332 bytes, SHA-1 `432f149c048bffce7f9de526ec65b336daf7a0a3`. The built QA and test APKs both declare minimum SDK 26, and the QA APK contains x86_64 native libraries. The image remains an emulator compatibility check, not evidence for a physical Android 8 device.

The API 26 source review found no additional test exclusions necessary: the speech test checks SDK 31 before accessing on-device recognition and exercises the unavailable fallback on API 26; photo import uses its pre-28 decoding branch. Location permission prompts remain outside smoke coverage through the existing saved/restored QA marker. The synthetic backend test retains its existing explicit opt-in condition. Runtime API/ABI, layout and native-library failures must fail the job rather than be hidden by SDK-wide skips. Direct runner invocation follows Android's [command-line testing guidance](https://developer.android.com/studio/test/command-line).

## Application acceptance

All account and mutation testing must use the synthetic QA build and the guarded local environment. Confirm its manifest and sentinel before any server-backed test. A failed environment check must stop writes; it must never fall back to production. Keep credentials, cookies and gateway nonces out of screenshots, issue bodies and committed evidence.

- [ ] Compare phone and tablet layouts with the Android Figma nodes, including typography, native insets, 8 dp search / 30 dp panel-row margins, controls, sheet detents, keyboard, large text and Chinese/English labels. The Web design's 11 px margins do not override the Android frames. Fixed Figma colors currently remain consistent with either system appearance.
- [ ] Verify map tiles and visible attribution, repeated zoom/pan/rotation, category colors, individual groups below 10 members, clusters of 10 or more, and marker selection at edges.
- [ ] Open a detail, Nearby, settings, account and contribution panel; close by back/close gesture and drag. Verify the appropriate parent panel, no gray map and no retained invisible overlay.
- [ ] Verify search cancellation and stale responses, empty/error states, network loss/recovery and foreground return without restarting the map.
- [ ] Verify login, register, session restore/expiry, nickname/avatar update, password change, logout and account switching with synthetic users. Check favorite add/remove and persistence across restart.
- [ ] Verify create/edit draft recovery after process death, last-character persistence, photo orientation/metadata removal, duplicate submit prevention, resumable upload and explicit recovery of uncertain edits.
- [ ] Verify drafts and workers never cross account/origin boundaries after logout or reauthentication. Retry interrupted writes only through the documented idempotent flow.
- [ ] Verify external navigation chooser with zero, one and multiple installed handlers; check provider coordinate conversion, sharing, and restoration after returning from another application.

## Device and compatibility gates

Record actual device evidence separately from simulator/test results. The local API 36 AOSP ARM64 emulator and CI's API 36 AOSP x86_64 emulator do not establish physical-device performance or sensor reliability.

- [ ] Test API 26 minimum support and API 37 target behavior, on phone and tablet with gesture and three-button navigation.
- [ ] Test a physical Android phone without Google Play services: map, location, permission denial, approximate location, revoked permission and disabled location services.
- [ ] Test heading on physical hardware while stationary and moving, after rotation/background return, with unreliable sensor accuracy and when the compass is absent. Never display an unavailable heading as measured.
- [ ] Test microphone permission, cancellation and recognized speech on a device with a recognizer, plus the unavailable/offline path on an AOSP device without one.
- [ ] Test background/foreground transitions, process recreation, low-memory recovery and upload resumption under real network changes.
- [ ] Measure release cold/warm startup, repeated map gestures, memory and battery use on a named physical device; record method and trace. Software-rendered emulator timings are not release performance evidence.
- [ ] Run the signed release on an actual 16 KB page-size environment and exercise native map rendering, images, navigation return and background recovery.

Before the OpenGL artifact replacement, the APK passed ZIP and ARM64/x86_64 PT_LOAD alignment checks. An actual API 37 ARM64 emulator reports 16384-byte pages. DataStore 1.2.0 initially triggered RELRO compatibility mode; after the official 1.2.1 patch, installed QA and preview both reported `pageSizeCompat=0`, and native QA/image/session tests passed. The OpenGL candidate has since passed focused Pixel API 37.2/16 KB checks; its complete API 26 and device-matrix acceptance remains pending. See the compatibility record for the exact candidate and scope. Some conservative RELRO formula warnings were recorded for the previous package; see [the compatibility record](compatibility-2026-09-20.md). **Final signed-release and other shipping-ABI acceptance remain open.** Repeat Android's [16 KB testing guidance](https://developer.android.com/guide/practices/page-sizes) on that release; successful QA and preview installation do not establish optimized release UI/performance acceptance.

## Signing, links and distribution

**Release signing and verified App Links are not configured or accepted yet.** The manifest's intent filter and URI parser tests do not establish operating-system domain verification.

- [ ] Choose the distribution channel, application ID, increasing version code, signing-key custodian and backup/recovery procedure. Configure release signing outside tracked source; never reuse the debug/QA certificate for production.
- [ ] Verify the signed artifact's certificate using `apksigner verify --print-certs`. If using Play App Signing, use the app-signing certificate for website association, not the upload certificate. Follow Android's [signing guidance](https://developer.android.com/studio/publish/app-signing).
- [ ] Publish and review `https://lycoris-map.com/.well-known/assetlinks.json` with package `com.lycoris.maps` and the actual release certificate SHA-256 fingerprint. This server change requires its own reviewed deployment; this Android workflow does not publish it.
- [ ] Install that signed release and verify its link state with `adb shell pm get-app-links com.lycoris.maps`. Test cold/warm valid place links, unknown/inactive IDs, malformed parameters and unrelated URLs. See [App Links verification](https://developer.android.com/training/app-links/verify-applinks).
- [ ] Confirm OSM attribution/cache behavior and the release tile-provider configuration. Tianditu remains unavailable until a valid native-use configuration passes actual requests; the existing browser key was rejected, and no forged browser headers should be added.
- [ ] Review privacy disclosures, requested permissions, photo processing, retained drafts and account-data handling against the shipping behavior.
- [ ] Archive the signed release, mapping file and completed acceptance evidence, then obtain release approval before store upload or distribution. This checklist and CI do not authorize publication.
