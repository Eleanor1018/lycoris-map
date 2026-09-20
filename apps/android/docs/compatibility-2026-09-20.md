# Android compatibility evidence — 2026-09-20

This record separates runtime results from release approval. Android source lives on `feat/android-native`; all server-backed mutations use the guarded synthetic QA environment.

## Android 17 / 16 KB

A dedicated `Lycoris_API37_16KB` emulator uses the official installed image `system-images;android-37.2;google_apis_playstore_ps16k;arm64-v8a`, revision 5. Emulator: 37.1.11.0; fingerprint: `google/sdk_gphone16k_arm64/emu64a16k:17/CP41.260828.004.A7/16296984:user/dev-keys`. The existing user AVD was not changed.

The runtime reports SDK 37, ARM64 and `getconf PAGE_SIZE = 16384`. The final QA APK installed and ran the complete instrumentation suite: 29 passes, two expected skips, zero failures (78.242 seconds). This Google Play image provides an on-device recognizer, so the unavailable-recognizer case skipped; the live-backend case requires explicit synthetic credentials. No actual speech recognition or hardware-sensor acceptance is implied.

The separately invoked Android → guarded Rust integration then passed: encrypted session restore, favorite add/remove, duplicate create requests and multi-chunk image upload. Read-only SQL verified one marker, one proposal and 763045 received bytes. The QA-only local-network permission was restored to its original denied state after the test. The same runner also passed on API 36.

The first run exposed a test-toolchain incompatibility: Compose's older transitive Espresso called the removed `InputManager.getInstance` method. An explicit Espresso 3.7.0 dependency uses the corrected implementation described in [AndroidX Test release notes](https://developer.android.com/jetpack/androidx/releases/test). Application release dependencies are unaffected by that test-only pin.

### Native alignment: original and corrected packages

The original package with DataStore 1.2.0 reported `pageSizeCompat=256`. Read-only inspection of this exact image's `framework.jar` identifies `ApplicationInfo.PAGE_SIZE_APP_COMPAT_FLAG_RELRO_NOT_ALIGNED = 256`; `PackageSetting.isPageSizeAppCompatEnabled()` in `services.jar` includes bit 256 in mask 300. That original run therefore used compatibility mode. Older public SDK source did not define the flag and could not explain it reliably.

After upgrading to the official DataStore 1.2.1 patch release, **both installed QA and optimized preview now report `pageSizeCompat=0`**. The final full QA suite and live image/Room/session integration passed with this corrected package. QA and release contain byte-identical ARM64 native libraries. The preview installed successfully; no claim is made that its optimized UI was visually accepted or that a production-signed release was tested.

ZIP alignment and all packaged ARM64/x86_64 `PT_LOAD` segments meet 16 KB alignment. A conservative static RELRO-end calculation gives:

| Packaged dependency | ARM64 RELRO end aligned | x86_64 RELRO end aligned |
|---|---|---|
| graphics-path 1.0.1 | No | No |
| datastore-core-android 1.2.1 | Yes | Yes |
| MapLibre Native 13.6.1 | Yes | No |

The remaining formula warnings do **not** mean the corrected ARM64 package is running in compatibility mode: the actual OS reports zero, and native QA tests pass. Keep the static observations separate from the runtime result. Follow [Android's page-size guidance](https://developer.android.com/guide/practices/page-sizes), verify every shipping ABI, and repeat on the final signed release. Do not patch ELF metadata to conceal a warning or claim acceptance from ZIP alignment alone.

## Minimum Android version

The new CI `api26` job uses Google's official AOSP API 26 x86_64 image and exactly the QA/test APKs built by the main job. It does not rerun R8. Its first successful remote result remains pending; configuration and APK minSdk declarations alone are not proof of Android 8 compatibility.

## Additional issues found during compatibility testing

- A subsequent API 36 CI run, [35490623833](https://github.com/Eleanor1018/lycoris-map/actions/runs/35490623833), failed while waiting for the unavailable-speech explanation. Code review confirmed that a delayed viewport/automatic-location error could overwrite the user's action notice. The fix separates action notices from background notices and retains the original five-second test timeout; deterministic ordering tests and a device assertion cover the competition. The failed run does not invalidate the earlier successful build, but requires a new successful candidate run.
- Android 17 denied the QA package's connection to `10.0.2.2:18187`, causing a TCP timeout before any live write. This matches the new [local-network permission requirement](https://developer.android.com/privacy-and-security/local-network-permission). The QA-only manifest and test runner now grant this permission temporarily for the selected Android user and verify restoration. The normal application uses public HTTPS services; APK manifest inspection confirms preview/release do not request the permission.

## Evidence location and remaining acceptance

Ignored local logs under `work/android-native/runtime` retain the original failure, corrected instrumentation output, ELF inspection and SDK-image diagnostics. Synthetic integration logs remain private under `apps/android/app/build/qa/device-tests`. Remote reports retain their run/artifact identity in CI.

Computer Use still reports a locked Mac; no native Figma comparison, visual map-tile acceptance or manual gesture result has been claimed. Physical GPS/compass, actual recognition, external navigation-app return and optimized performance remain separate device gates. See [progress.md](progress.md) and [release-checklist.md](release-checklist.md).

Final local verification: 124 JVM tests, 29 Python guard/runner tests, 30 passing API 36 device tests plus one expected skip, and the API 37 results above. The formerly failing speech fallback case passed again separately without increasing its timeout. QA lint and all QA/test/preview/unsigned-release builds passed.
