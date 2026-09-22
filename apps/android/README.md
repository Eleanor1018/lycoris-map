# Lycoris for Android

Native Kotlin and Jetpack Compose app. Minimum SDK is 26; compile/target SDK is 37. Gradle and dependencies are pinned in the wrapper and version catalog. Use JDK 17 or newer and a matching Android SDK.

## Build

Set `sdk.dir` in ignored `local.properties`, or set `ANDROID_HOME`. From `apps/android/`:

```sh
./gradlew :app:assembleDebug
./gradlew :app:testQaUnitTest :app:lintQa
./gradlew :app:assembleQa :app:assemblePreview :app:assembleRelease
```

`debug`, `qa`, and `preview` have separate package IDs and storage. Preview is optimized and uses the real HTTPS API, but is signed with the debug certificate. Release is unsigned unless [release signing](docs/signing.md) is configured. Build artifacts are under `app/build/outputs/`.

Use only the `qa` variant for automated writes. Its isolated Rust backend, fixture gateway, and opt-in device runner are documented in [testing-qa.md](docs/testing-qa.md). The [release checklist](docs/release-checklist.md) covers CI and device checks.

## Map providers

OSM uses MapLibre and the existing Cloudflare tile route; core browsing and location do not require Google Play services. Tencent uses its native SDK, Tianditu uses WMTS through MapLibre, and optional Google Maps requires its key and Play services.

Set provider keys in ignored `local.secrets.properties`, or use the corresponding environment variables:

| Local property       | Environment variable            |
| -------------------- | ------------------------------- |
| `tencentMapsApiKey`  | `LYCORIS_TENCENT_MAPS_API_KEY`  |
| `tiandituMapsApiKey` | `LYCORIS_TIANDITU_MAPS_API_KEY` |
| `googleMapsApiKey`   | `LYCORIS_GOOGLE_MAPS_API_KEY`   |

Gradle properties `lycoris.<localProperty>` are also supported. Register the actual Android package and signing certificate with each provider; a Web key is not an Android authorization. Keys are bundled client configuration, so apply provider restrictions and keep them out of Git. CI uses `LYCORIS_TIANDITU_MAPS_API_KEY_APP` for the Tianditu native key.

Chinese prefers configured Tencent Maps; English prefers OSM. A saved, available choice takes precedence. Tencent asks for its privacy choice before SDK initialization. Provider switches preserve the geographic camera; API data and contribution drafts remain WGS84.

## Structure

`core/` contains API clients, repositories, map/location adapters, media handling, and storage. `feature/` contains the Compose screens and contribution engine. One Activity keeps the map alive while saved panel state controls navigation. Room and WorkManager preserve resumable contributions.

See the [project architecture](../../ARCHITECTURE.md), [platform actions](app/src/main/java/com/lycoris/maps/core/platform/README.md), and [contribution lifecycle](app/src/main/java/com/lycoris/maps/feature/contributions/README.md). Preserve bundled attribution and third-party licenses.
