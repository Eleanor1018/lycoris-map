# Lycoris for iOS

Native SwiftUI application, Apple Maps / MapKit, iPhone, iOS 26+. Open `Lycoris.xcodeproj` in Xcode and select the shared **Lycoris** scheme.

## Current scope: I2

The four Figma surfaces are available: collapsed, Nearby, expanded, and place details. The live Apple map remains stable while the panel moves. Original assets, String Catalog, configuration and meaningful interaction tests are included. Real API data and business actions start in I3. Unconnected controls use a native unavailable alert; they do not report a successful login, share, navigation, edit or saved bookmark.

The default app is anonymous with no sample bookmarks or selected place. Xcode canvas previews and explicit Debug launch arguments inject design fixtures without creating a login session. Release ignores the preview arguments.

In Xcode's Run scheme arguments, add `-lycoris-preview` followed by one of `collapsed`, `nearby`, `expanded`, `anonymousExpanded`, or `details`. `expanded` includes the three reference bookmark rows; tap one to open details. Clear the arguments to return to the anonymous default. The same variants are available in `App/MapPreviewScenario.swift` as named canvas previews.

Fixture text, photo and coordinates are only visual reference data. The Figma toilet title, decorative photo and New Jersey map coordinate do not describe a verified real place. See `docs/i2-acceptance.md` for validation and phase boundaries.

The initial map camera uses the public New Jersey area shown in the design. It is not the user's current location. No location permission is requested by I1.

## Toolchain and build

Verified local tools: Xcode 26.6, Swift 6.3.3, iOS 26.5 SDK/runtime. Swift 6 language mode and complete concurrency checking are enabled. No package dependencies.

The Mac's default developer directory currently points to Command Line Tools. Use Xcode itself or select its toolchain per command:

```sh
cd apps/ios
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project Lycoris.xcodeproj -scheme Lycoris \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath /tmp/lycoris-ios-build \
  CODE_SIGNING_ALLOWED=NO build

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project Lycoris.xcodeproj -scheme Lycoris \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath /tmp/lycoris-ios-build \
  CODE_SIGNING_ALLOWED=NO test
```

Simulator builds do not need a signing team. A physical device requires the owner's Xcode signing team. The bundle ID is currently `com.lycoris.maps`; confirm release identity when preparing distribution.

## Service address

Debug defaults to `http://127.0.0.1:8080`, the local Rust backend from the simulator. Release deliberately has no service address until the new HTTPS endpoint is supplied; `AppConfiguration` represents that as unconfigured, never silently using the development host.

For a physical iPhone, create ignored `Config/Local.xcconfig` with the Mac's reachable development address:

```xcconfig
LYCORIS_API_BASE_URL = http:/$()/your-mac.local:8080
```

The `$()` escape preserves the double slash in an xcconfig URL. The phone and Mac must have a reachable network path; local network permission may be requested when API calls are introduced. Only Debug has a local-network ATS exception. Do not put credentials in configuration URLs. I1 does not issue backend requests; API behavior is developed in I3 onward.

## Structure and design

- `App`: app entry.
- `Features/Map`: persistent Map view, panel state, layout, search row, tool groups and prototype content.
- `Core/API`: environment configuration and validation.
- `Resources`: asset catalog and English / Simplified Chinese strings.
- `LycorisTests`: configuration boundaries, panel geometry and map camera preservation.
- `LycorisUITests`: keyboard/drag behavior, preview routing and anonymous bookmark visibility.
- `docs`: design references, gaps and acceptance evidence.

The system sheet was prototyped first. On iOS 26.5 its largest detent becomes edge-to-edge; the design keeps 10 points on both sides. `PanelLayout` therefore owns only the custom container's geometry. SwiftUI controls, MapKit and system materials remain native. The map is not conditionally removed or keyed by panel state.

`NativeMapView` is a small `MKMapView` bridge. Public layout margins place attribution above the panel's lowest resting position. It stays fixed while the panel moves, as recommended by [Apple's Maps guidance](https://developer.apple.com/design/human-interface-guidelines/maps/); expanded panels temporarily cover it. When device geometry or text size changes those margins, MapKit coordinate conversions preserve the geographic point under the screen center, camera distance and heading. I1 uses a flat map (pitch gestures disabled); rotation, pan and zoom remain native.

Future phases replace prototype content behind this container. Refer to `docs/design-mapping.md` before adding screens that are not yet present in the iOS Figma page.
