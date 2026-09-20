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

The preview APK is installable with the debug certificate and runs the same R8 optimization as release, with shell profiling enabled. It uses a separate `.preview` application ID and real HTTPS endpoints. It supports local performance and browsing checks, but must not be distributed as a production-signed release.

- [x] The workflow passed on implementation commit `3edbd76`: [run 35489996913](https://github.com/Eleanor1018/lycoris-map/actions/runs/35489996913). Retain a new run for any later application-source changes; this is not a signed release approval.
- [x] Local XML: 120 JVM tests and 30 passing device tests, with only the opt-in backend case skipped. That backend case passed separately against guarded Rust/Postgres. Remote CI logs confirm the same expected skip and no test failures; lint has no errors (dependency-upgrade/style warnings remain).
- [ ] Install and open the resulting QA APK; verify its application ID is `com.lycoris.maps.qa`.
- [ ] Review release R8 output and test a correctly signed release build. CI's `app-release-unsigned.apk` is an unsigned build artifact, not an installable store release.
- [ ] Retain release APK/AAB hashes, version code, mapping file and dependency/toolchain versions with the release record.

CI action releases were checked against their official repositories on 2026-09-20 and pinned to full commit SHAs: [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-java v6.0.1](https://github.com/actions/setup-java/releases/tag/v6.0.1), [setup-gradle v6.3.0](https://github.com/gradle/actions/releases/tag/v6.3.0), [android-emulator-runner v2.38.0](https://github.com/ReactiveCircus/android-emulator-runner/releases/tag/v2.38.0), and [upload-artifact v7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1). JDK 17, Gradle 9.4.1 and Build Tools 36.0.0 follow the [AGP 9.2 compatibility table](https://developer.android.com/build/releases/agp-9-2-0-release-notes). The compile platform package is `platforms;android-37.0`.

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

The foundation APK passed ZIP alignment and ARM64/x86_64 ELF alignment checks recorded in `progress.md`. CI also checks release ZIP alignment. **16 KB runtime acceptance is still unverified**: packaging alignment and a 4 KB emulator are insufficient. Verify the runtime page size with `adb shell getconf PAGE_SIZE`, and follow Android's [16 KB testing guidance](https://developer.android.com/guide/practices/page-sizes) for the actual signed release and every packaged native library.

## Signing, links and distribution

**Release signing and verified App Links are not configured or accepted yet.** The manifest's intent filter and URI parser tests do not establish operating-system domain verification.

- [ ] Choose the distribution channel, application ID, increasing version code, signing-key custodian and backup/recovery procedure. Configure release signing outside tracked source; never reuse the debug/QA certificate for production.
- [ ] Verify the signed artifact's certificate using `apksigner verify --print-certs`. If using Play App Signing, use the app-signing certificate for website association, not the upload certificate. Follow Android's [signing guidance](https://developer.android.com/studio/publish/app-signing).
- [ ] Publish and review `https://lycoris-map.com/.well-known/assetlinks.json` with package `com.lycoris.maps` and the actual release certificate SHA-256 fingerprint. This server change requires its own reviewed deployment; this Android workflow does not publish it.
- [ ] Install that signed release and verify its link state with `adb shell pm get-app-links com.lycoris.maps`. Test cold/warm valid place links, unknown/inactive IDs, malformed parameters and unrelated URLs. See [App Links verification](https://developer.android.com/training/app-links/verify-applinks).
- [ ] Confirm OSM attribution/cache behavior and the release tile-provider configuration. Tianditu remains unavailable until a valid native-use configuration passes actual requests; the existing browser key was rejected, and no forged browser headers should be added.
- [ ] Review privacy disclosures, requested permissions, photo processing, retained drafts and account-data handling against the shipping behavior.
- [ ] Archive the signed release, mapping file and completed acceptance evidence, then obtain release approval before store upload or distribution. This checklist and CI do not authorize publication.
