# Nearby panel compatibility check — 2026-09-21

The owner reports continuous map/panel movement on both realme and Xiaomi phones after entering Nursing Rooms, sometimes accompanied by missing text and icons. The affected devices are remote; their exact models, OS versions, logs and installed APK identities are not available. The issue remains open. No application fix is claimed by this test run.

## Test environment

- Source and QA artifacts: `feat/android-native`, `1b823a5df999ed66b6c3ab84be279c3139e88e0e`.
- New local AVD: `Lycoris_Galaxy_S25_API36`, displayed in Android Studio as `Galaxy S25 size - AOSP 16`.
- Official AOSP API 36 ARM64 image, Android 16, no Google Play services, 2 GB RAM, two virtual CPU cores, 60 Hz configuration.
- Runtime display confirmed by `wm size` / `wm density`: 1080 × 2340 pixels, 420 dpi.
- Device proxy remained `null`; no app data was cleared, no physical location was used and no production account/data mutation was performed.

The resolution follows the [Galaxy S25 display specification](https://developer.samsung.com/galaxy-emulator-skin/galaxy-s.html); the 420 dpi setting is a test density. This is **not Samsung One UI, Samsung firmware or a Samsung GPU**. No Samsung emulator skin was installed. Samsung's [skin documentation](https://developer.samsung.com/galaxy-emulator-skin/guide.html) explicitly states that skins alter appearance and do not include One UI features. This AVD is a display/OS compatibility comparison, not Samsung device acceptance.

## Completed native checks

| Suite | Result | Scope |
| --- | --- | --- |
| `HomePanelStabilityTest`, `MapPanelTest`, `PanelAdaptationTest` | 11 passed, 27.234 s | Nursing Rooms entry, changing loading/empty/long-list content, panel bounds, drag/close, lazy long lists, large text and viewport changes |
| `MapLifecycleTest`, `OsmViewportIntegrationTest`, `TiandituViewportIntegrationTest`, Tencent's online viewport case | 4 passed, 25.257 s | Native renderer lifecycle, real provider loading, overlays, camera retention and background return |

The HomeScreen stability fixture uses a 360 × 640 dp content area, density 2.625 and font scale 1.3. It reopens Nursing Rooms twice, switches through loading/empty/eight-result/empty states and performs 12 map-layer state updates per phase. Settled panel bounds remain within the existing 1 px assertion. These are synthetic QA interactions, not reproduction with the friends' production data or optimized release package.

OSM reported fetched/parsed center tiles and fully rendered frames before and after background return. Both Tianditu sources loaded; the synthetic marker/location checks and Tianditu → OSM → Tianditu transition passed. The Tencent case passed native authentication/loading, marker and return/switch assertions. Passing these checks does not establish hardware compass, sustained physical-device frame pacing or absence of the reported OEM-device defect.

## Release artifact and manual acceptance

The existing signed `Lycoris-Maps-0.1.0-1b823a5.apk` was installed successfully alongside the isolated QA package. Its SHA-256 is `cee553d2cdef57ce5272c94040332ce5d32d9234ac9a8e54a33dadaceacf48a7`. Package inspection confirms `com.lycoris.maps`, version 0.1.0 / code 1, ARM64 and no debuggable flag.

Manual release acceptance was blocked by Computer Use window targeting: input intended for Android Studio's floating Running Devices window landed in the editor instead. The standalone emulator was also unavailable as a controllable app in Computer Use. The temporary IDE launch-window preference was restored. **Installation is not a claim that the release screen, fonts, icons or gestures were visually verified.**

Local runtime logs are `galaxy-s25-aosp16-panel-tests.log` and `galaxy-s25-aosp16-provider-tests.log` in the existing ignored `work/android-native/runtime` evidence directory. No application source change was made in this follow-up.

## Remaining reproduction evidence

Obtain a short recording of the affected flow, exact model/Android version and installed APK version from an affected phone. Distinguish missing app text/icons from map labels. A physical OEM device (or Samsung Remote Test Lab for actual Samsung coverage) is still needed to assess vendor graphics/runtime behavior. The emulator passes do not close the realme/Xiaomi report or justify attributing it to missing OEM system components.
