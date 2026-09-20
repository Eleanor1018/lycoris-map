# iOS coordinate alignment — 2026-09-19

The iOS map displayed canonical WGS84 marker coordinates directly on a mainland
MapKit renderer using GCJ-like coordinates. This caused a large northwest shift.
A separate SVG anchor error lifted the visible pin tip 4 screen points; it had no
horizontal component and could not explain the geographic error.

## Measured public control point

No device location or production marker was used for this comparison.

| Oriental Pearl Tower | Latitude | Longitude |
| --- | --- | --- |
| OSM building vertex mean | 31.2418974784 | 121.4952673205 |
| Apple public POI result on the host | 31.239703 | 121.499718 |
| Approximate GCJ conversion of OSM mean | 31.2398980932 | 121.4997166225 |

The raw POI coordinates differ by about 488 m; the converted building mean is
about 22 m from Apple's POI, within the building. On both macOS and the iPhone 17
simulator, actual MapKit snapshots put the raw WGS point in the Huangpu River to
the northwest and the converted point on the tower. The iOS check covered both
Explore and Satellite. A temporary XCTest invoked the production resolver and
adapter; the simulator independently selected `gcj02`. The temporary network
probe was removed from the regular test suite to keep it deterministic.

Reference: [OSM way 40778038, version 45](https://api.openstreetmap.org/api/0.6/way/40778038/full.json).
OSM coordinates are [WGS84](https://wiki.openstreetmap.org/wiki/Node).

## Boundary contract

- `GeoPoint`, Core Location, API payloads, drafts and distance calculations remain
  canonical WGS84. Existing server data is not rewritten.
- `MapCoordinateSpace` explicitly projects marker/focus/selection coordinates,
  native map snapshots and Apple Maps destination handoff. Picking and physical
  screen-center callbacks convert in the reverse direction before entering stores.
  MapKit owns the native user-location annotation; it is not converted twice.
- Viewport centers are canonical. Bounds conservatively cover both sides of the
  regional transform, including coastlines and curved edges. A 0.02-degree margin
  is used only on bounds intersecting the mainland region; date-line splitting
  and world clamps remain intact. The current backend viewport endpoint has no
  result limit that could discard visible pins due to this overscan.
- Mainland coverage comes from Natural Earth 1:10m, version 5.1.1, `ADM0_A3=CHN`,
  excluding separate HKG/MAC/TWN records. Geographic neighbors are not moved.
  Latitude-indexed edges avoid walking the full geometry for each pin.
- When a coastal/border point has conflicting inside/outside interpretations,
  picking is rejected instead of silently saving a different canonical location.
  The coverage mask is cartographic, not a survey-precision boundary.

## Provider calibration and failure behavior (updated 2026-09-20)

Apple exposes no documented provider/datum selector. A bounded eight-second
`MKLocalSearch` request uses a fixed public landmark, a required region and exact
landmark names. Only an unambiguous result within 100 m of one reference and more
than 250 m from the other is accepted. Conflicting, unrelated or failed results
leave the working coordinate space unchanged. This is an empirically validated calibration heuristic, not
an Apple provider API or a guarantee about every device/provider combination.

The live app starts with the **GCJ02 mainland display convention measured above**;
the coverage mask leaves other regions unchanged. A separate calibration flag
keeps the landmark lookup running in the background even though the initial
display space is already usable. This is a fallback based on the verified
renderer, not a claim that an uncompleted lookup has succeeded. An unambiguous
WGS84 result can still replace it. Explicit preview/test coordinate overrides
remain fixed. No locale/SIM inference or persisted unverified value is used.

A verified result is cached in memory for this screen session. Repeated calls share one in-flight lookup;
connectivity recovery/foreground/manual retry queues at most one retry if the
old attempt fails afterward. Cancellation invalidates late results.

The original unresolved startup policy was a regression: it prevented mainland
viewport publication (so the API was never called) and filtered all mainland
annotations. Normal startup no longer enters that state. Browsing, point display
and viewport requests continue during a pending or failed landmark lookup. The
coordinate adapter still rejects ambiguous coastal/border picks. A late verified
calibration refreshes projections and viewport queries without undoing a user's
intervening pan, rotation or zoom.

## Regression coverage and remaining device checks

Deterministic tests cover independent conversion reference values, mainland and
neighboring cities, canonical serialization, inverse round trips, ambiguous
coastal picks, unresolved selection, tap-to-saved-coordinate-to-pin alignment at
three map headings, viewport containment, late camera movement, cancellation and
permission/network recovery races. Existing map, nearby, startup permission,
voice-panel and accessibility tests are also exercised.

Physical iPhone checks still matter: verify the actual reported marker(s), native
blue-dot alignment, walking-route destination handoff, speech input and successful
login after network access is allowed. A historical marker already stored in a
different datum would need a separate data audit; this change does not guess or
rewrite its original meaning.

Formula and data notices are bundled in `Resources/MapCoordinates-LICENSE.txt`.

## 2026-09-20 — user-location regression correction

The previous calibration gate also blocked the generic focus created from a
successful GPS fix. If landmark search failed or could not be classified, tapping
Locate silently consumed the focus while leaving the camera unchanged. Earlier
UI fixtures forced a resolved WGS84 mode and missed this failure path.

`MapFocus.Target` now separates a canonical place coordinate from a native
`userLocation` intent. Locate and location-anchored Nearby use MapKit `.follow`;
MapKit waits for its own user-location fix and centers the blue dot in its native
display space. This requires no landmark lookup, coordinate transform or backend
response. Authorized manual Locate starts following immediately while Core
Location separately refreshes canonical data. A late canonical fix cannot replay
that camera intent after a pan. Place selection stops native following and keeps
the existing coordinate adapter. Calibration completion never replays native
user following, and revocation invalidates location focus and callbacks.
While native following is active, inset updates leave camera positioning to
MapKit instead of applying the free-browsing camera compensation. The Locate
button now has the same explicit 48-by-48-point rectangular hit area as its
neighboring controls; previously its accessibility frame covered only the glyph.

The new regression first failed against the old implementation (no native follow
request after a successful mainland fix). Unit coverage now includes unresolved
and both resolved spaces, permission gating, place selection, stale callbacks,
late calibration and Nearby origins. `LocationFocusFlowTests` deliberately makes
landmark lookup fail and checks tracking plus the actual native blue-dot
annotation frame at startup and after panning and tapping Locate's padding. A
delegate-time `isUserLocationVisible` snapshot preceded annotation layout, so
the UI assertion reads the rendered annotation rather than caching visibility.
Its failure injection and coordinate-free
accessibility diagnostics are compiled only into the isolated Test configuration.

Verification: 25 unit tests across LocationFocus, MapCoordinate, MapViewport and
PlaceData passed, along with the startup/pan/Locate UI regression on iPhone 17
(iOS 26.5 Simulator). The UI test restores its synthetic location afterward and
performs no backend writes.

The follow-up marker regression checks a real `PlaceStore` viewport request and
pin projection while calibration is pending and after failure. It prevents a
location-only success from hiding an otherwise empty map again.
