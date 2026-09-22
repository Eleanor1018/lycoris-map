# Android platform actions

`PlaceLink.parse(intent.dataString)` accepts the Web share URL
`https://lycoris-map.com/maps?markerId=<positive Int64>[&lang=en|zh]` and the existing
iOS route `lycoris://maps?markerId=…`. Optional language never changes device preferences.
The cold-start and `onNewIntent` Activity paths must both use this parser. All other
hosts, userinfo, ports, fragments, unknown/duplicate fields and malformed IDs are rejected.

`PlaceSharing.share(context, id, title, language)` launches the native Android Sharesheet.
`NavigationLauncher(context).showChooser(context, NavigationDestination(id, title, lat, lng), chooserTitle)`
queries installed, enabled and exported map handlers at tap time, deduplicates by package,
and offers explicit components through `Intent.createChooser` + `EXTRA_ALTERNATE_INTENTS`.
There is no remembered/default Google target. `EXTRA_INITIAL_INTENTS` is deliberately
avoided because modern Android caps it at two additional activities. API 29+'s
`EXTRA_AUTO_LAUNCH_SINGLE_CHOICE=false` retains a choice even with one map app.

`ExternalActionResult.NoNavigationApp` returns a safe HTTPS OSM destination URL for an
explicit UI action. Do not automatically open it. Bind the user's fallback button to
`openWebFallback(context, destination, chooserTitle)`. Catching ActivityNotFound/Security
also covers apps being removed/disabled between query and launch. `Opened` only means
the chooser launched, not that a provider successfully calculated a route.

Package visibility queries required under `<queries>`:

- `ACTION_VIEW` + `geo` scheme (all compatible OSM and other clients).
- Package `com.autonavi.minimap` (AMap).
- Package `com.baidu.BaiduMap` (Baidu).
- Package `com.tencent.map` (Tencent).
- Package `com.google.android.apps.maps` (Google).

Tencent's native route requires a developer key; pass `tencentDeveloperKey` only when a
real key is configured. Without one Tencent can appear only when it declares a compatible
standard `geo` handler. No fake key, network lookup, SDK, origin coordinates or saved-user
location is used. The Tencent `fromcoord=CurrentLocation` literal asks that chosen app to
obtain its own origin; it sends no Lycoris GPS value. Baidu likewise receives only the
`origin=我的位置` placeholder already used by Web, not origin coordinates.

Application/model/API coordinates remain WGS84. Only outgoing AMap/Tencent endpoints use
GCJ02 and mainland Baidu endpoints use BD09. Outside the coverage mask Baidu receives
WGS84 with `coord_type=wgs84`; generic `geo` and Google remain WGS84 everywhere. The mask
is the same Natural Earth 1:10m asset used by iOS, including its limitations at coastlines.
Approximate regional formulas are not survey-grade conversion. Iterative inverse tests
verify numerical round trips and explicitly reject ambiguous boundary overlaps. If the
asset fails to load, documented AMap/Baidu native WGS84 flags are used, not a bounding-box
approximation; Tencent custom route is unavailable.

Official sources verified 2026-09-20:

- [Android common map intents](https://developer.android.com/guide/components/intents-common#Maps)
- [Android chooser and alternate intents](https://developer.android.com/reference/android/content/Intent#EXTRA_ALTERNATE_INTENTS)
- [Google navigation intent](https://developer.android.com/guide/components/google-maps-intents)
- [AMap Android route (2025-10-15)](https://lbs.amap.com/api/amap-mobile/guide/android/route)
- [Baidu Android URI and coordinate types](https://lbsyun.baidu.com/docs/webapi?title=mapadjustment%2Furi%2Fandriod)
- [Tencent mobile route](https://lbs.qq.com/webApi/uriV1/uriGuide/uriMobileRoute)

Real installed-map chooser presentation, native provider route behavior and returning to
the app require device/instrumented acceptance; JVM URL/coordinate tests do not prove them.
