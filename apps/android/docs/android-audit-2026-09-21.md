# Android audit — 2026-09-21

Audit started on 2026-09-21 and continued on 2026-09-22. Baseline `feat/android-native`
commit: `42460c7`. Sue executed the checks and implementation; Wen reviewed the evidence and
corrected the test coordinates and Foundation API usage before accepting the patch for CI.
Only `MapPanel.kt`, `MapPanelTest.kt` and this report are included in the fix.

## Automated totals

| Suite | Result |
| --- | --- |
| JVM (`unit`) | 143 tests, 0 failures / 0 errors / 0 skipped |
| Python guards (`guards`) | 29 tests, OK |
| Full AOSP instrumentation | 60 run: 53 pass, 2 fail, 5 skip (skip code -4) |
| Pixel instrumentation | interrupted; no complete pass count |
| `backend-aosp` | failed at instrumentation with `ApiFailure.Network`; investigation remains open |
| `loaded-aosp` | no complete result |
| `panels-aosp` (fix round) | environment-blocked; no log produced |

## Full AOSP run

Two failures, both in `AppConfigurationTest`:

- `realImeKeepsSearchAndLoginOpenOnFirstBackAndLastButtonReachable`: the search field was focused
  (`focused=true, immActive=true, immAcceptingText=true, imeVisible=true`) but the IME bottom inset
  stayed `0` (`imeBottom=0`, `visibleFrame` bottom 2214 vs `decorSize` 2340), with
  `show_ime_with_hard_keyboard=0`. **Not confirmed as a product defect**; consistent with the
  known AOSP keyboard fixture limitation.
- `actualOrientationRebuildRetainsPrimarySelectionCameraAndSelectedPlaceId`: `ComposeNotIdleException`.

The 5 skips are the expected opt-in cases (live OSM/Tianditu/Tencent, live backend, loaded-detail
rotation). No global keyboard setting or device proxy was changed. QA fixtures were not reset.

## Panel layout defect (this round)

**Reproduced red (list path), before the fix** — `regression-aosp-20260921-220839.log`:

```
middleY=957.0 heldY=1056.0 afterResizeY=957.0 expected:<1056.0> but was:<957.0>
```

A held drag inside the LazyColumn moved the sheet to 1056; when the result set grew while the
finger was still down, the header snapped back to the old middle detent 957, losing the drag.

**Fix.** `MapPanel` now reads Foundation's real drag signals
(`handleInteractions.collectIsDraggedAsState()` and `scroll.interactionSource.collectIsDraggedAsState()`)
and records the page/stop that owns the drag. When a drag is active for the same page/stop, the
layout pass keeps the visible top by adding the measured `full` delta to the previous finite offset
and clamping into the new bounds, then compensates with `state.dispatchRawDelta` in the same measured
pass. The programmatic `LaunchedEffect` no longer keys on `geometry`, so re-measurement cannot steal
an in-progress gesture; explicit `requestedStop`/`pageKey` control is retained. Natural height,
25 dp corners, drag-to-close, nested list scrolling and gesture animation are unchanged.

Regression coverage added in `MapPanelTest`: `contentResizeDuringHeldListDragKeepsFingerProgress`
(list path) and `contentResizeDuringHeldGrabberDragKeepsFingerProgress` (grabber path), sharing one
helper, with the existing `assertEquals(heldY, afterResizeY, 1f)` kept unrelaxed.

**Green evidence is pending.** The fix compiled (`unit`: 143 JVM, QA + androidTest APKs built), but
`panels-aosp` timed out without a complete log after a device restart. A separate boot check later
returned `1`, so this cannot be diagnosed solely as incomplete boot. The red result above is from before the fix; no green device result is
claimed.

## Unconfirmed / not accepted

- CI `42460c7`: `HomePanelStabilityTest.nearbyLoadingEmptyAndLongResultsSettleWithFractionalDensity`
  failed to find `PaneTitle = NEARBY`; API 26 skipped on a dependency job failure. The same case
  passed locally on AOSP, so it is **not stably reproduced**.
- `backend-aosp`: the in-app run failed with an Android `ApiFailure.Network`. The local QA gateway and
  Rust backend real login/logout were just verified with the generated Alice, and an emulator `nc`
  HEAD to the gateway returned 200. Server/favourite logic is therefore **not** claimed broken; the
  network path stays open.
- `loaded-aosp`: no complete result.
- Physical-device heading, speech, permission dialogs and manual visual acceptance are **not accepted**
  (Mac locked).

No credentials, cookies or absolute private paths are recorded here.
