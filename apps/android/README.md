# Lycoris Android

Native Kotlin / Jetpack Compose application. The Android design is Figma page `32:2454`; implementation and acceptance progress are recorded in `docs/progress.md`.

## Toolchain

- Android SDK 37, Build Tools 36.0.0; minimum API 26.
- AGP 9.2.1 with built-in Kotlin, Compose compiler 2.3.10, Compose BOM 2026.09.00.
- Gradle 9.4.1 (wrapper checksum pinned). JDK 17 or newer; local verification uses Android Studio JBR 25.
- MapLibre Native 13.6.1, using the official OpenGL ES artifact; the core map/location flow does not require Google Play services. See the [renderer compatibility record](docs/compatibility-2026-09-20.md).

Set `sdk.dir` in ignored `local.properties`, or `ANDROID_HOME`, then:

```sh
./gradlew :app:assembleDebug
./gradlew :app:assembleQa :app:testQaUnitTest
./gradlew :app:assemblePreview
./gradlew :app:assembleRelease
```

Debug (`.debug`), synthetic QA (`.qa`), optimized preview (`.preview`), and release have separate app storage. `app/build/outputs/apk/preview/app-preview.apk` is an installable, R8-optimized, profileable preview signed with the local debug certificate. It uses the real HTTPS API, contains no synthetic accounts, and is not a production-signed store release. Release signing remains unconfigured; `app-release-unsigned.apk` cannot be installed as-is. Never use preview or release for automated write tests. See [isolated testing](docs/testing-qa.md) and the [release checklist](docs/release-checklist.md).

OSM tiles use an identifiable native User-Agent and disk HTTP cache with visible attribution. No offline bulk downloads are implemented. The existing browser-only Tianditu key rejected native WMTS requests with HTTP 403 / code 301012 on 2026-09-20, so it is not offered in the native selector. OpenStreetMap is the default; the selector also exposes native Google Maps when configured and Google Play services are available. No key belongs in tracked source.

The single Activity keeps the native map alive while an explicit saved panel state handles Explore/Bookmarks/Settings, detail, account and contribution flows. Account subpages have their own back handling. This deliberately uses a small `SavedStateHandle` state machine instead of introducing a second AndroidX Navigation stack for one persistent map screen. Cold and hot intent parsing is exercised separately from operating-system App Links verification.

The Android implementation started at baseline `c139926`. Both native clients belong to this repository under `apps/ios` and `apps/android`. The visible Android worktree is `/Users/nora/lycoris-map-android` on `feat/android-native`; open `/Users/nora/lycoris-map-android/apps/android/settings.gradle.kts` in Android Studio. The iOS working directory stays `/Users/nora/lycoris-map` on `feat/ios-native`. Keep the actual Android worktree open in the IDE, and report its branch, build variant, device and installed version when handing work over for testing. Completion requires runtime evidence, not just a successful build. Device tests and Figma references are recorded in [progress.md](docs/progress.md).

## Native Google Maps comparison

The optional provider uses Maps SDK for Android 20.0.0. Enable that SDK in the Google Cloud project, then put `googleMapsApiKey=...` in ignored `apps/android/local.secrets.properties`, or supply `LYCORIS_GOOGLE_MAPS_API_KEY` when building. A Gradle property `lycoris.googleMapsApiKey` is also supported. Configure Android restrictions for the intended package and signing certificate SHA-1: Preview is `com.lycoris.maps.preview`, QA is `com.lycoris.maps.qa`, and release is `com.lycoris.maps`. `./gradlew :app:signingReport` lists the local test certificates. Never put the key in a tracked file or a shared build log.

Without a key, or without usable Play services, Google Maps is disabled with an explanation and OSM remains usable. Adding the dependency does not make OSM/location require GMS. Switching provider retains the geographic camera and shares the app's place/category, bookmark, location and heading data. Google keeps its own visible attribution. Actual Google tile rendering still requires a valid key; value-object and selector tests cannot establish network/service availability.

On first foreground launch, the app requests coarse/fine location once; compass sensors start with the foreground lifecycle and need no separate runtime permission. `INTERNET` and `ACCESS_NETWORK_STATE` are normal manifest permissions, not permission dialogs. Only the isolated QA build, on API 37+, subsequently requests local-network access to reach the host test backend. Preview/release use HTTPS and do not request local-network access. Denial does not loop; location can be retried explicitly with the locate button.

## Search settings

Settings follows the iOS row order: Choose Language, Search Type, Searching Range, Map Source, About Lycoris Maps. Search Type persists All / Accessible Toilets / Nursing Rooms / Medical Institutions. It derives keyword and voice-search results from the complete server response using the latest selection, including when that selection changes during a request. All retains custom categories. Changing the type does not make a new network request or change explicit Nearby categories, viewport results or bookmarks. About shows the installed app version and the shared Lycoris introduction.
