# Lycoris for iOS

Native SwiftUI application, Apple Maps / MapKit, iPhone, iOS 26+. Open `Lycoris.xcodeproj` in Xcode and select the shared **Lycoris** scheme.

## Current scope: I4

The Figma map shell now reads public places from the Rust backend: viewport markers, debounced search, three Nearby categories, marker selection and real details. Core Location is requested from the location/Nearby controls; denied or unavailable location falls back to the explicitly labelled map center. Place sharing opens the native share sheet with a public Apple Maps destination link, and Navigate opens walking directions in Apple Maps. No user origin is embedded in shared links.

I4 connects account-password login and registration, cookie session restoration, logout, profile fields, native photo selection and avatar upload, password changes, Bookmarks and My Places. Login and registration use fully native SwiftUI navigation and grouped forms, following the user’s updated preference. Profile and library screens also use native Form/List. Editing, contribution, settings destinations and voice input remain I5–I6 work. No server deployment is performed.

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
  -project Lycoris.xcodeproj -scheme Lycoris \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath /tmp/lycoris-ios-build \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test
```

Simulator builds do not need a signing team, but must keep local ad-hoc signing enabled for Keychain access; do not use `CODE_SIGNING_ALLOWED=NO` for account tests. A physical device requires the owner's Xcode signing team. The bundle ID is currently `com.lycoris.maps`; confirm release identity when preparing distribution.

## Service address

Debug defaults to `http://127.0.0.1:8080`, the local Rust backend from the simulator. Release deliberately has no service address until the new HTTPS endpoint is supplied; `AppConfiguration` represents that as unconfigured, never silently using the development host.

For a physical iPhone, create ignored `Config/Local.xcconfig` with the Mac's reachable development address:

```xcconfig
LYCORIS_API_BASE_URL = http:/$()/your-mac.local:8080
```

The `$()` escape preserves the double slash in an xcconfig URL. The phone and Mac must have a reachable network path. The existing synthetic Docker stack binds only to loopback, so changing this URL alone does not make it reachable from a phone. Network exposure and device signing are separate setup steps. Local-network permission may be requested by iOS. Only Debug has a local-network ATS exception. Do not put credentials in configuration URLs. Public reads use a separate cookie-free URLSession. Release without a configured service displays an unavailable state and can still browse the base map.

## Structure and design

- `App`: app entry.
- `Features/Map`: persistent Map view, panel state, request lifecycle, search, Nearby and tool groups.
- `Core/API`: environment configuration, public DTOs, transport and HTTP diagnostics.
- `Core/Location`: WGS84 values, viewport splitting and on-demand Core Location.
- `Features/Places`: shared rows, real details, public images and native share sheet.
- `Features/Account`: session and private data lifecycle, Figma auth forms, native profile/password/library screens, and avatar encoding.
- `Resources`: asset catalog and English / Simplified Chinese strings.
- `LycorisTests`: configuration, HTTP/DTO boundaries, request races, coordinates, panel geometry and camera preservation.
- `LycorisUITests`: keyboard/drag, design previews, public browsing and isolated synthetic account acceptance flows.
- `docs`: design references, gaps and acceptance evidence.

The system sheet was prototyped first. On iOS 26.5 its largest detent becomes edge-to-edge; the design keeps 10 points on both sides. `PanelLayout` therefore owns only the custom container's geometry. SwiftUI controls, MapKit and system materials remain native. The map is not conditionally removed or keyed by panel state.

`NativeMapView` is a small `MKMapView` bridge. Public layout margins place attribution above the panel's lowest resting position. It stays fixed while the panel moves, as recommended by [Apple's Maps guidance](https://developer.apple.com/design/human-interface-guidelines/maps/); expanded panels temporarily cover it. When device geometry or text size changes those margins, MapKit coordinate conversions preserve the geographic point under the screen center, camera distance and heading. I1 uses a flat map (pitch gestures disabled); rotation, pan and zoom remain native.

Future phases replace prototype content behind this container. Refer to `docs/design-mapping.md` before adding screens that are not yet present in the iOS Figma page.

## I3 local acceptance

`LivePlaceTests` only runs when `http://127.0.0.1:8080/api/markers/1` identifies the existing **S1 Synthetic Shanghai Center** fixture. Otherwise those tests skip; isolated unit and design interaction tests remain usable without a backend. Live tests perform no backend writes. They exercise permission denial, a temporary simulated Shanghai location (restored afterward), all categories, search, empty results, native sharing dismissal and opening Apple Maps.

For a manual simulator review, use `-lycoris-test-center` followed by `31.2304,121.4737` in Debug. This only chooses the initial camera; all places still come from the API. The default New Jersey camera has no points in the current Shanghai-only fixture database. Both this argument and all visual preview arguments are ignored by Release.

Search debounces for 300 ms and viewport reads for 250 ms. Cancellation plus generation checks prevent late responses from replacing a newer state. Nearby keeps its captured origin while the map pans. A fresh location fix may update that origin only while its original action is still active. A 404 removes the old pin and reloads the other public results; image errors retain the textual detail. Search results and annotations are not silently truncated.

The new public Lycoris domain is still unconfigured. Until it is supplied, Share uses the public Apple Maps destination; it does not invent a Lycoris URL or enable Universal Links. Real-world historical-coordinate alignment, physical-device permissions and route correctness remain device acceptance work.

## I4 account behavior

The account URLSession uses iOS cookie storage and disables URL caching and credential storage. Server-issued persistent cookies are also synchronously saved to device-only Keychain storage after Set-Cookie, so an immediate process termination cannot lose the session. The snapshot preserves domain, path, Secure, HttpOnly and the server expiry; session-only/expired cookies are not persisted. Empty snapshots preserve logout, and each service origin restores only once per process. Passwords are kept only in form state and cleared after a request; there is no password store. Public marker/image sessions remain cookie-free. Startup and foreground transitions revalidate `/api/me`; a 401 clears identity and private content, while an outage retains the last verified identity with an error. Login, logout and account writes serialize; response generations reject stale identities, libraries and private photos.

Anonymous users see no Bookmarks group. Logged-in users see its heading, up to three native reference rows, or a compact empty/loading message. The heading opens the full list. A bookmark tap while anonymous opens login and resumes the original save after authentication. Failed writes display feedback without claiming success. Owned private or pending places and their images use the authenticated session; no private images enter the public image cache.

The account sheet supports nickname, pronouns and signature, a native PhotosPicker, password change and My Places. Photos are orientation-corrected, downsampled to 1024px and encoded as JPEG before upload. Profile forms can be pulled to refresh after conflicts. My Places retains the server's public/private and review status. Apple/Google login is explained in a native form footer, without fake provider actions. Verification remains a noninteractive unavailable row; registration needs no verification code. Password recovery and account deletion have no supported backend flow and are not presented as working actions.

`AccountFlowTests` writes only to the identified loopback synthetic stack using dedicated random accounts persisted inside the test runner's container. It never uses a real account or previous S1/S4 credentials. The fixture's own profile, password session version, avatar, favorites and private place may change. For its native photo picker test, seed the selected simulator with the synthetic avatar via `xcrun simctl addmedia <device-id> <synthetic-avatar.png>`. The password test deliberately reuses the fixture password while verifying invalidation of another session. No passwords or cookies belong in repository artifacts.

Keychain references: [Apple access class](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly), [signing/entitlement diagnostics](https://developer.apple.com/documentation/security/errsecmissingentitlement). Local ad-hoc simulator signing supplies the app identity; physical-device and App Store signing remain separate release work.
