# Lycoris for iOS

Native SwiftUI and MapKit app for iPhone and iPad. The deployment target is iOS 26; Swift 6 mode and complete concurrency checking are enabled. There are no external package dependencies.

## Build and run

Open `Lycoris.xcodeproj` in Xcode and select the Lycoris scheme. Use a simulator or configure your signing team for a physical device. From `apps/ios/`:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project Lycoris.xcodeproj -scheme Lycoris \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath /tmp/lycoris-ios-build \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
```

Choose an installed simulator if that name is unavailable. Keep ad-hoc signing enabled for simulator Keychain access.

## API configuration

Debug and Release use `https://api.lycoris-map.com`, configured in `Config/Base.xcconfig`. Release requires HTTPS. To point Debug at a local backend, create ignored `Config/Local.xcconfig`:

```xcconfig
LYCORIS_API_BASE_URL = http:/$()/127.0.0.1:8080
```

The `$()` preserves the double slash in xcconfig syntax. A physical phone needs the Mac's reachable address instead of loopback. Remove the local override to return to the normal API.

The separate **Test** configuration always uses loopback and does not read `Local.xcconfig`. Use it for [automated tests and fixtures](docs/testing.md); never point write tests at production.

## Structure

- `App/`: entry point, shared services, and explicit visual previews.
- `Core/`: API transport, location/coordinate boundaries, preferences, and link parsing.
- `Features/`: map panels, search, places, accounts, contributions, and settings.
- `Resources/`: images, string catalogs, privacy manifest, and asset licenses.
- `LycorisTests/`, `LycorisUITests/`: unit and UI tests.

The map stays alive while panels change. API/storage coordinates remain WGS84; provider conversion belongs at the MapKit boundary. Account changes invalidate private data and drafts. Contributions preserve receipts and reconcile interrupted image uploads. See the shared [architecture](../../ARCHITECTURE.md).

## Distribution

For TestFlight, configure the `com.lycoris.maps` app record and signing team, select a device build, then use **Product → Archive** and Organizer to validate and distribute it. Increment the build number for each upload. Simulator builds and successful unit tests are not distribution artifacts.

Before shipping, check iPhone/iPad layouts, VoiceOver, larger text, Reduce Motion/Transparency, permissions, navigation return, account flows, and interrupted uploads on devices. Review the privacy manifest and store disclosures against the shipping behavior.

Original design asset provenance is listed in [figma-assets.md](docs/figma-assets.md). Third-party coordinate data retains its bundled license.
