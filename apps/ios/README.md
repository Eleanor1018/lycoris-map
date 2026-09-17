# Lycoris for iOS

Native SwiftUI application, Apple Maps / MapKit, iPhone, iOS 26+. Open `Lycoris.xcodeproj` in Xcode and select the shared **Lycoris** scheme.

## Current scope: I6

The Figma map shell now reads public places from the Rust backend: viewport markers, debounced search, three Nearby categories, marker selection and real details. Core Location is requested from the location/Nearby controls; denied or unavailable location falls back to the explicitly labelled map center. Place sharing opens the native share sheet with a Lycoris place identifier link, and Navigate opens walking directions in Apple Maps. Shared links contain no coordinates, user origin or credentials.

I4 connects account-password login and registration, cookie session restoration, logout, profile fields, native photo selection and avatar upload, password changes, Bookmarks and My Places. Login and registration use fully native SwiftUI navigation and grouped forms, following the user’s updated preference. Profile and library screens also use native Form/List. I5 adds native contribution and editing forms, map location selection, durable drafts and resumable photo proposals. I6 adds persistent language/radius settings, native source/about screens, on-device voice search, place links and accessibility refinements. No server deployment is performed.

The default app revalidates its persisted account cookie; without a valid session it is anonymous, with no sample bookmarks or selected place. Xcode canvas previews and explicit Debug launch arguments inject design fixtures without creating a login session. Release ignores the preview arguments.

In Xcode's Run scheme arguments, add `-lycoris-preview` followed by one of `collapsed`, `nearby`, `expanded`, `anonymousExpanded`, or `details`. `expanded` includes the three reference bookmark rows; tap one to open details. Clear the arguments to return to the anonymous default. The same variants are available in `App/MapPreviewScenario.swift` as named canvas previews.

Fixture text, photo and coordinates are only visual reference data. The Figma toilet title, decorative photo and New Jersey map coordinate do not describe a verified real place. See `docs/i3-acceptance.md` and `docs/i4-acceptance.md` for API behavior and validation. Explicit visual previews disable networking and real sharing/navigation.

The initial map camera uses the public New Jersey area shown in the design. It is not the user's current location. Startup does not request location or start the user-location layer; that begins only after a location/Nearby action.

## Toolchain and build

Verified local tools: Xcode 26.6, Swift 6.3.3, iOS 26.5 SDK/runtime. Swift 6 language mode and complete concurrency checking are enabled. No package dependencies.

The Mac's default developer directory currently points to Command Line Tools. Use Xcode itself or select its toolchain per command:

```sh
cd apps/ios
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project Lycoris.xcodeproj -scheme Lycoris \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath /tmp/lycoris-ios-build \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project Lycoris.xcodeproj -scheme Lycoris -configuration Test \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath /tmp/lycoris-ios-build \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test
```

Simulator builds do not need a signing team, but must keep local ad-hoc signing enabled for Keychain access; do not use `CODE_SIGNING_ALLOWED=NO` for account tests. A physical device requires the owner's Xcode signing team. The bundle ID is currently `com.lycoris.maps`; confirm release identity when preparing distribution.

## Service address

Normal Xcode Run (Debug) and Release use `https://api.lycoris-map.com`. The shared address is in `Config/Base.xcconfig`; the same HTTPS service works from the simulator and a physical iPhone. API calls and `/uploads` media use this origin. An unconfigured address still produces an unavailable state, and Release rejects HTTP.

Xcode Test uses the separate **Test** build configuration with the fixed synthetic backend `http://127.0.0.1:8080`. It does not include `Local.xcconfig`. This keeps the installed test app, including cold deep-link launches, on the same backend as fixture preflights. UI suites skip outside Test, so overriding a test run with `-configuration Debug` cannot send fixture registrations/contributions to the live service. Use `-configuration Test` for CLI fixture tests.

To deliberately run a Debug app against a local development backend, create ignored `Config/Local.xcconfig`. For the simulator:

```xcconfig
LYCORIS_API_BASE_URL = http:/$()/127.0.0.1:8080
```

The `$()` escape preserves the double slash in an xcconfig URL. Remove the override to return to the live service. A physical phone cannot reach the Mac through `127.0.0.1`; local-device development needs a reachable Mac address and a deliberate listener setup. The synthetic Docker stack currently binds only to loopback. Debug/Test have a local-network ATS exception; Release uses the standard HTTPS policy. Public reads remain cookie-free, and account cookies/drafts stay scoped to their service origin. Connection validation is recorded in `docs/service-connection.md`.

## Structure and design

- `App`: app entry.
- `Features/Map`: persistent Map view, panel state, request lifecycle, search, Nearby and tool groups.
- `Core/API`: environment configuration, public DTOs, transport and HTTP diagnostics.
- `Core/Preferences`, `Core/Navigation`: validated preferences and strict place-link parsing.
- `Features/Settings`, `Features/Search`: native settings and device-only voice input.
- `Core/Location`: WGS84 values, viewport splitting and on-demand Core Location.
- `Features/Places`: shared rows, real details, public images and native share sheet.
- `Features/Account`: session and private data lifecycle, native auth/profile/password/library screens, and image encoding.
- `Features/Contributions`: native form, protected draft journal, marker writes and resumable photo protocol.
- `Resources`: asset catalog and English / Simplified Chinese strings.
- `LycorisTests`: configuration, HTTP/DTO boundaries, request races, coordinates, panel geometry and camera preservation.
- `LycorisUITests`: keyboard/drag, design previews, public browsing and isolated synthetic account acceptance flows.
- `docs`: design references, gaps and acceptance evidence.

`PanelLayout` owns the floating collapsed container and its continuous transition to edge-to-edge Nearby and Expanded states, following the user's latest iOS refinements. Section headings share the same leading alignment. SwiftUI controls, MapKit and system materials remain native. The map is not conditionally removed or keyed by panel state.

`NativeMapView` is a small `MKMapView` bridge. Public layout margins place attribution above the panel's lowest resting position. It stays fixed while the panel moves, as recommended by [Apple's Maps guidance](https://developer.apple.com/design/human-interface-guidelines/maps/); expanded panels temporarily cover it. When device geometry or text size changes those margins, MapKit coordinate conversions preserve the geographic point under the screen center, camera distance and heading. I1 uses a flat map (pitch gestures disabled); rotation, pan and zoom remain native.

Future phases replace prototype content behind this container. Refer to `docs/design-mapping.md` before adding screens that are not yet present in the iOS Figma page.

## I3 local acceptance

`LivePlaceTests` only runs when `http://127.0.0.1:8080/api/markers/1` identifies the existing **S1 Synthetic Shanghai Center** fixture. Otherwise those tests skip; isolated unit and design interaction tests remain usable without a backend. Live tests perform no backend writes. They exercise permission denial, a temporary simulated Shanghai location (restored afterward), all categories, search, empty results, native sharing dismissal and opening Apple Maps.

For a manual simulator review, use `-lycoris-test-center` followed by `31.2304,121.4737` in Debug. This only chooses the initial camera; all places still come from the API. The default New Jersey camera has no points in the current Shanghai-only fixture database. Both this argument and all visual preview arguments are ignored by Release.

Search debounces for 300 ms and viewport reads for 250 ms. Cancellation plus generation checks prevent late responses from replacing a newer state. Nearby keeps its captured origin while the map pans. A fresh location fix may update that origin only while its original action is still active. A 404 removes the old pin and reloads the other public results; image errors retain the textual detail. Search results and annotations are not silently truncated.

The API domain is configured; shared HTTPS links and Universal Links are a separate feature. I6 uses the registered `lycoris://maps?markerId=<Int64>` scheme for installed-app sharing, with fresh access checks when opening. It has no uninstalled-app fallback yet. Real-world historical-coordinate alignment, physical-device permissions and route correctness remain device acceptance work.

## I4 account behavior

The account URLSession uses iOS cookie storage and disables URL caching and credential storage. Server-issued persistent cookies are also synchronously saved to device-only Keychain storage after Set-Cookie, so an immediate process termination cannot lose the session. The snapshot preserves domain, path, Secure, HttpOnly and the server expiry; session-only/expired cookies are not persisted. Empty snapshots preserve logout, and each service origin restores only once per process. Passwords are kept only in form state and cleared after a request; there is no password store. Public marker/image sessions remain cookie-free. Startup and foreground transitions revalidate `/api/me`; a 401 clears identity and private content, while an outage retains the last verified identity with an error. Login, logout and account writes serialize; response generations reject stale identities, libraries and private photos.

Anonymous users see no Bookmarks group. Logged-in users see its heading, up to three native reference rows, or a compact empty/loading message. The heading opens the full list. A bookmark tap while anonymous opens login and resumes the original save after authentication. Failed writes display feedback without claiming success. Owned private or pending places and their images use the authenticated session; no private images enter the public image cache.

The account sheet supports nickname, pronouns and signature, a native PhotosPicker, password change and My Places. Photos are orientation-corrected, downsampled to 1024px and encoded as JPEG before upload. Profile forms can be pulled to refresh after conflicts. My Places retains the server's public/private and review status. Apple/Google login is explained in a native form footer, without fake provider actions. Verification remains a noninteractive unavailable row; registration needs no verification code. Password recovery and account deletion have no supported backend flow and are not presented as working actions.

`AccountFlowTests` writes only to the identified loopback synthetic stack using dedicated random accounts persisted inside the test runner's container. It never uses a real account or previous S1/S4 credentials. The fixture's own profile, password session version, avatar, favorites and private place may change. For its native photo picker test, seed the selected simulator with the synthetic avatar via `xcrun simctl addmedia <device-id> <synthetic-avatar.png>`. The password test deliberately reuses the fixture password while verifying invalidation of another session. No passwords or cookies belong in repository artifacts.

Keychain references: [Apple access class](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly), [signing/entitlement diagnostics](https://developer.apple.com/documentation/security/errsecmissingentitlement). Local ad-hoc simulator signing supplies the app identity; physical-device and App Store signing remain separate release work.

## I5 contribution behavior

The pen opens login if needed, then location selection on the existing MapKit instance. Tap the map to place a native pin; tap again to adjust it. Panning, pinching and double-tap zoom preserve the selected coordinate. “Use this location” stays disabled until a location is selected and opens the contribution form without submitting it. When VoiceOver is active, “Select map center” provides a nonspatial alternative. Reopening selection centers the map on the saved draft location; Cancel discards only the tentative selection and keeps the saved fields and coordinates. A native NavigationStack/Form contains the Figma contribution fields: title, three categories, description, optional opening/closing times and one optional photo. Native DatePicker and PhotosPicker provide input. There is no public/private control. An existing place opens an editor from its detail action; its coordinates and visibility are preserved.

Closing the form keeps its single local draft. Tap the pen to return to saved work. Draft JSON and the final orientation-correct, 2048px JPEG are written atomically in Application Support with iOS file protection and excluded from backups. The upload hashes those saved bytes; resumed requests never re-encode the photo. File/receipt validation rejects missing, corrupt or mismatched checkpoints. Explicit discard clears local work; it cannot retract an already submitted proposal.

New places freeze their UUID and payload before sending and recover safely after lost responses. Text edits have no server idempotency key: an unknown result is persisted and never automatically resent. Explicit resend requires a native confirmation explaining possible duplication. Photo-only edits skip PATCH. Successful text/image submissions remain awaiting review; live details are never optimistically replaced.

Photos use the existing Rust start/status/256KiB chunk/complete endpoints. Each retry reconciles the server receipt first, including after a lost completion or missing local photo. Network failures back off up to 60 seconds and resume while active, on connectivity restoration or when the app returns. Expiry/file rejection requires selecting the photo again; quotas and nontransient errors pause. There is no guaranteed background execution or transfer after force quit; the next launch resumes persisted work.

All contribution requests share the account mutation gate, verify `/api/me`, and check owner, configured service origin and live login epoch. Logout/account replacement cancels and purges the old draft and photo. Late responses cannot recreate the previous user's UI or dispatch under a new cookie. Startup waits for verified identity before loading a saved contribution. See `docs/i5-acceptance.md` for validation evidence.

## I6 settings and system behavior

Settings uses a native inset-grouped List with system separators and 44pt rows at standard text sizes; accessibility text grows vertically. Its five rows open native Form sheets. English / Simplified Chinese take effect immediately in the interface and API requests and persist across launches. Model-derived strings use the selected localization bundle too. Nearby defaults to 1000m. Searching Range contains one native numeric field with an m suffix; existing values are preserved, and edits save when input finishes or the sheet closes. Empty or out-of-range input keeps the last saved value; the accepted range remains 1 to 50,000m. Language/radius changes invalidate older requests while preserving the current map camera and the captured Nearby center. Existing contribution drafts retain their content language.

Search Type persists All / Accessible Toilets / Nursing Rooms / Medical Institutions. It filters keyword results, including confirmed voice-search text, using the latest selection. The current Rust search endpoint returns the complete, unpaginated result set and does not accept a category parameter, so the store keeps the original response and derives filtered results without another request. All includes custom categories. Explicit Nearby categories and viewport loading keep their own behavior; changing the type during an in-flight search cannot restore an older selection.

The map icon opens a compact native Map Style sheet with a system zoom transition from the button. Explore uses Apple's standard map; Satellite uses Apple's hybrid imagery with road labels. Both preserve the existing map instance, camera and Lycoris places, and the choice persists. Native MapKit snapshots preview the current area. Larger accessibility text uses a scrollable single-column layout. The Settings map-source entry continues to identify Apple Maps.

The microphone opens native voice search. Recording requires both speech and microphone permission and an available on-device recognizer. Audio is not sent to a speech server; only confirmed search text reaches the normal search endpoint. Unsupported devices offer the keyboard. Dismissal, backgrounding, interruptions and input loss stop recording and invalidate pending callbacks; a session ends after at most 55 seconds. Returning from Settings never silently restarts the microphone: Retry explicitly checks permissions again.

Place links accept only the registered scheme/host and a positive Int64 ID. Unknown sources, duplicate parameters, credentials, fragments and malformed IDs are rejected. Optional `lang=en|zh` is accepted for compatibility, but the recipient's chosen language takes precedence. Public reads are cookie-free; a public 404 may fall back to a verified, owner/epoch-scoped account read. Private details/photos remain in AccountStore. Dismissed or superseded link sheets cannot open late results. An already-open sheet or location selection must be closed before opening a link.

VoiceOver headers, detail focus, refreshed annotation labels, 44pt touch targets, accessibility-size layouts, opaque panels under Reduce Transparency, and the existing Reduce Motion behavior support system preferences. Foreground checks refresh location authorization and remove revoked location references. See `docs/i6-acceptance.md` for tests and remaining real-device checks.
