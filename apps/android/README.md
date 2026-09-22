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

Debug (`.debug`), synthetic QA (`.qa`), optimized preview (`.preview`), and release have separate app storage. `app/build/outputs/apk/preview/app-preview.apk` is an installable, R8-optimized, profileable preview signed with the local debug certificate. It uses the real HTTPS API, contains no synthetic accounts, and is not a production-signed store release. Optional [release signing](docs/signing.md) produces `app-release.apk` when configured; CI without signing credentials still produces `app-release-unsigned.apk`, which cannot be installed as-is. Never use preview or release for automated write tests. See [isolated testing](docs/testing-qa.md) and the [release checklist](docs/release-checklist.md).

OSM tiles load through the existing Web Cloudflare Worker at `https://lycoris-map.com/tiles/osm/{z}/{x}/{y}.png`, with an identifiable native User-Agent, disk HTTP cache and visible attribution. The Worker keeps the fixed OSM upstream and cache policy; Android does not send tile traffic through the Rust backend. No offline bulk downloads are implemented. Tianditu is available with its separate native-use key (see below). Without a manual selection, Chinese uses native Tencent Maps when configured and English uses OSM. An explicitly chosen available provider always wins across language changes and restarts, including an explicit choice of OSM or Tianditu. The selector also exposes native Google Maps when configured and Google Play services are available. No key belongs in tracked source.

The single Activity keeps the native map alive while an explicit saved panel state handles Explore/Bookmarks/Settings, detail, account and contribution flows. Account subpages have their own back handling. This deliberately uses a small `SavedStateHandle` state machine instead of introducing a second AndroidX Navigation stack for one persistent map screen. Cold and hot intent parsing is exercised separately from operating-system App Links verification.

Accessible toilets display the API's `venueType` (metro, hospital, mall, railway station, school or other) in lists and details. Unknown/missing labels are not guessed. Native contribution forms preserve the selected venue in saved drafts and submissions; changing to another place category clears it. Android uses the existing server schema and does not perform classification, deduplication or deactivation migrations.

Opening hours use native Material 3 colors and informational tags. Status matches Web: the point's `hoursTimezone` controls the clock, closing is exclusive, overnight ranges are supported and equal endpoints mean 24-hour availability. The last 30 minutes before closing display a warning. Missing/invalid zones show the schedule without claiming open/closed status. One lifecycle-aware clock refreshes visible content each minute and immediately when returning to the app. Secondary panel headings use the same 30 dp inset as content, with 12 dp extra top space and 8 dp below; the bottom panel has 25 dp top corners.

Place details use 11 dp between content groups and above/below their heading. Category and distance share a row; venue and opening-hours badges share a wrapping row that accommodates larger text. The edit action sits immediately after Share. The search account entry displays the same public thumbnail as the profile, scoped to the user, session epoch and avatar URL; missing/failed images show initials and logout restores the anonymous placeholder.

Explore, Bookmarks and Settings use 11 dp outer content insets and 11 dp between headings and their content, including the expanded Positions section. The grabber occupies 28 dp: 8 dp above the 4 dp indicator and 16 dp below it. The measured middle stop includes this same grabber height, so the default Explore panel still fits all three nearby categories.

The Android implementation started at baseline `c139926`. Both native clients belong to this repository under `apps/ios` and `apps/android`. The visible Android worktree is `/Users/nora/lycoris-map-android` on `feat/android-native`; open `/Users/nora/lycoris-map-android/apps/android/settings.gradle.kts` in Android Studio. The iOS working directory stays `/Users/nora/lycoris-map` on `feat/ios-native`. Keep the actual Android worktree open in the IDE, and report its branch, build variant, device and installed version when handing work over for testing. Completion requires runtime evidence, not just a successful build. Device tests and Figma references are recorded in [progress.md](docs/progress.md).

## Native Google Maps comparison

The optional provider uses Maps SDK for Android 20.0.0. Enable that SDK in the Google Cloud project, then put `googleMapsApiKey=...` in ignored `apps/android/local.secrets.properties`, or supply `LYCORIS_GOOGLE_MAPS_API_KEY` when building. A Gradle property `lycoris.googleMapsApiKey` is also supported. Configure Android restrictions for the intended package and signing certificate SHA-1: Preview is `com.lycoris.maps.preview`, QA is `com.lycoris.maps.qa`, and release is `com.lycoris.maps`. `./gradlew :app:signingReport` lists the local test certificates. Never put the key in a tracked file or a shared build log.

Without a key, or without usable Play services, Google Maps is disabled with an explanation and OSM remains usable. Adding the dependency does not make OSM/location require GMS. Switching provider retains the geographic camera and shares the app's place/category, bookmark, location and heading data. Google keeps its own visible attribution. Actual Google tile rendering still requires a valid key; value-object and selector tests cannot establish network/service availability.

On first foreground launch, the app requests coarse/fine location once; compass sensors start with the foreground lifecycle and need no separate runtime permission. `INTERNET` and `ACCESS_NETWORK_STATE` are normal manifest permissions, not permission dialogs. Only the isolated QA build, on API 37+, subsequently requests local-network access to reach the host test backend. Preview/release use HTTPS and do not request local-network access. Denial does not loop; location can be retried explicitly with the locate button.

## Search settings

Settings follows the iOS row order: Choose Language, Search Type, Searching Range, Map Source, About Lycoris Maps. Search Type persists All / Accessible Toilets / Nursing Rooms / Medical Institutions. It derives keyword and voice-search results from the complete server response using the latest selection, including when that selection changes during a request. All retains custom categories. Changing the type does not make a new network request or change explicit Nearby categories, viewport results or bookmarks. About shows the installed app version and the shared Lycoris introduction.

## Native Tencent Maps

Tencent Maps uses the official Android SDK `6.13.0.260731.bb0666d5.209828299` and its same-generation foundation `0.9.1.6875646-lite`. The lite foundation avoids bundling the full foundation's optional Bugly native library, whose x86_64 build is only 4 KB aligned. Tencent's map libraries are 16 KB aligned. This provider does not require Google Play services or add Tencent's location SDK; existing Android foreground location/heading controllers remain in use.

Set `tencentMapsApiKey=...` in ignored `local.secrets.properties`, or build with `LYCORIS_TENCENT_MAPS_API_KEY` / Gradle property `lycoris.tencentMapsApiKey`. The GitHub workflow reads the repository secret `LYCORIS_TENCENT_MAPS_API_KEY`; absent keys disable Tencent and let Chinese fall back to OSM. Keys belong to build configuration, not tracked source. Enable Android Map SDK for the intended package in Tencent's key console: `com.lycoris.maps.debug`, `.qa`, `.preview`, and `com.lycoris.maps` for release. A browser key's presence alone is not proof that its Android authorization works.

The first Tencent use asks for its privacy choice before initializing the SDK, including when Tencent is the language default. Declining selects OSM. This choice is separate from the manual provider preference. Provider switches preserve WGS84 camera state and world scale; only renderer coordinates, overlay positions and incoming SDK clicks are converted at the GCJ-02 boundary. API queries and saved contributions stay WGS84. The shared mainland coverage/conversion approximation is not survey-grade; ambiguous boundary picks are ignored. Tencent viewport query envelopes conservatively include the possible coordinate offset. Its logo remains visible above the bottom sheet; auth/load failures use the existing retry/change-map feedback.

Run the ordinary unit/instrumentation suites without online dependencies. Opt-in, read-only map checks on the QA package accept `-e lycorisOsmOnline true` and `-e lycorisTencentOnline true` with the respective `OsmViewportIntegrationTest` and `TencentMapTest` classes. Tencent's check uses a synthetic Shanghai viewport/marker and no live device fix or account records.

References: [official Android SDK sample](https://github.com/TencentLBS/TencentMapDemo_Android), [Tencent key configuration](https://tencentlbs.github.io/TencentMapDemo_Android/config/key.html), [SDK lifecycle](https://tencentlbs.github.io/TencentMapDemo_Android/show_map/mapview.html).

## Tianditu WMTS

Tianditu uses the existing native MapLibre renderer with HTTPS `vec_w` roads and `cva_w` Chinese labels, through the official WMTS endpoint on `t0.tianditu.gov.cn`. The service's GetCapabilities response confirms the `w` matrix is EPSG:900913 with 256-pixel tiles: vector levels 1–18 and labels 1–19. Labels stay above the base map; existing place/category, location/heading and interaction overlays stay above both. Geographic application coordinates are preserved without the Tencent GCJ-02 conversion. Both raster sources must fetch/parse tiles before the successful-frame callback can dismiss loading feedback. Visible attribution opens Tianditu's site.

Set `tiandituMapsApiKey=...` in ignored `local.secrets.properties`, or provide `LYCORIS_TIANDITU_MAPS_API_KEY` / Gradle property `lycoris.tiandituMapsApiKey`. CI reads the repository secret `LYCORIS_TIANDITU_MAPS_API_KEY_APP`; absent keys disable this option and preserve the normal language defaults. The owner manages this App key in Actions secrets; Android does not read the separate Web key. Use [the correct package/signing certificate](docs/signing.md) when registering the key. The previous browser-only key's rejection does not apply to the newly supplied native-use key; the latter returned valid PNGs for both layer requests without forged browser headers.

The opt-in QA test `com.lycoris.maps.core.map.TiandituViewportIntegrationTest`, with `-e lycorisTiandituOnline true`, checks actual center-tile fetch/parse events for both layers, fully rendered frames, synthetic WGS84 marker/location overlays, marker selection, background return and Tianditu → OSM → Tianditu camera retention. It does not use account records, live GPS or backend writes. WMTS request success does not establish a separate Tianditu native SDK authentication flow; no Tianditu SDK was added.

Provider reference: [Tianditu map service](https://lbs.tianditu.gov.cn/server/MapService.html). Runtime capability verification uses the same HTTPS WMTS endpoints with `SERVICE=WMTS&REQUEST=GetCapabilities` and the configured key; avoid logging the key-bearing request URL.

## Email verification

Registration now requires a six-digit emailed code. The login page also opens
password recovery with email, code and matching new-password fields. The client
uses `/api/auth/email-code` with `register` or `reset_password`, and
`/api/auth/reset-password`; sending includes `X-App-Language`. Server
`Retry-After` controls resend/cooldown feedback. Five wrong codes lock that email
for an hour; closing the page cannot clear the server lock. Successful recovery
clears the local session and private lists and returns to login.

Publish this client with the Web/backend email-verification release. Older
clients can log in but cannot register after mandatory verification is enabled.
SMTP credentials remain exclusively on the server. Local acceptance:
`:app:testQaUnitTest` (147 tests), `:app:assembleQa`, and
`:app:compileQaAndroidTestKotlin`. Repository tests cover code/purpose/address
payloads, cooldown responses, and session clearing after recovery; no real email
is sent by those tests.
