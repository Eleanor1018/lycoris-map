# Lycoris Android

Native Kotlin / Jetpack Compose application. The Android design is Figma page `32:2454`; implementation and acceptance progress are recorded in `docs/progress.md`.

## Toolchain

- Android SDK 37, Build Tools 36.0.0; minimum API 26.
- AGP 9.2.1 with built-in Kotlin, Compose compiler 2.3.10, Compose BOM 2026.09.00.
- Gradle 9.4.1 (wrapper checksum pinned). JDK 17 or newer; local verification uses Android Studio JBR 25.
- MapLibre Native 13.6.1; the core map/location flow does not require Google Play services.

Set `sdk.dir` in ignored `local.properties`, or `ANDROID_HOME`, then:

```sh
./gradlew :app:assembleDebug
./gradlew :app:assembleQa :app:testQaUnitTest
./gradlew :app:assembleRelease
```

Debug (`.debug`), synthetic QA (`.qa`), and release have separate app storage. Release signing is deliberately not configured yet. Never use the production build for automated write tests. See `scripts/` and the testing notes as QA is brought up.

OSM tiles use an identifiable native User-Agent and disk HTTP cache with visible attribution. No offline bulk downloads are implemented. The existing browser-only Tianditu key rejected native WMTS requests with HTTP 403 / code 301012 on 2026-09-20, so OSM remains the available provider until an appropriate native key is configured. No key belongs in tracked source.

The initial baseline is `c139926`; Android work is isolated from the iOS worktree. Completion requires runtime evidence, not just a successful build.
