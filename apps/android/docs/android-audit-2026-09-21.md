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
| `panels-aosp` (fix round) | 15 run: 15 pass, 0 fail, 0 skip — `panels-aosp-20260922-100843.log` |

## CI run `35661794312` (commit `c8e2a05`)

143 JVM, lint, all APK builds and the 16 KB alignment check passed. API 36 had exactly two failures:
`HomePanelStabilityTest` could not find `PaneTitle = NEARBY` (also fails on the baseline), and the new
grabber held regression reported `middleY=364 heldY=476 afterResizeY=516` (an extra 40 px). The new
list held regression passed. API 26 was skipped because an upstream job failed.

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

**Grabber replay root cause.** Foundation 1.12.1 `AnchoredDraggableNode.drag` runs
`state.anchoredDrag { forEachDelta { ... } }`; its parent `DraggableNode` loop is
`while (...) { (event as? DragDelta)?.let(processDelta); event = channel.receive() }`. Changing anchors
restarts `anchoredDrag`, which re-processes the last `DragDelta` still held in `event` — replaying the
final 40 px. This is why the grabber path (outer `anchoredDraggable`) overshot by exactly one move.

**Outer gesture fix.** The outer `anchoredDraggable` is replaced with Foundation's plain `draggable` +
`rememberDraggableState { delta -> state.dispatchRawDelta(delta) }`, so a mid-drag anchor change cannot
restart a gesture event loop and replay a delta. `userFling`/`defaultFling` are retained: in
`onDragStopped` a `ScrollScope` whose `scrollBy` only calls `state.dispatchRawDelta(pixels)` runs
`with(userFling) { scrollScope.performFling(velocity) }`. `interactionSource = handleInteractions` is
kept; the same-pass compensation and the `requestedStop`/`pageKey` programmatic effect are unchanged.

**Green (local, after the fix)** — `panels-aosp-20260922-100843.log`: `OK (15 tests)`, 15 pass / 0 fail
/ 0 skip. Both held regressions pass (list and grabber), together with the remaining 13 cases,
including `HomePanelStabilityTest`. The earlier red (`middleY=957 heldY=1056 afterResize=957`) is from before the
fix; the grabber overshoot was only observed in CI `35661794312` before this change.

**Nearby diagnostics.** `HomePanelStabilityTest.nearbyLoadingEmptyAndLongResultsSettleWithFractionalDensity`
now counts `onCloseSecondary` calls, asserts the state is still open after each content change with a
message carrying cycle/count/selected/close calls, and keeps the original PaneTitle assertion (a
missing node raises an enriched message instead of a sleep). This separates an accidental close from a
semantics-tree timing gap in CI.

**Test entry precondition.** `performClick` is a real coordinate click (ui-test-android 1.12.1
`Actions.android.kt`: `performClickImpl() = performTouchInput { click() }`), not a direct `onClick`
call. The fixture forces `Density(2.625f, fontScale = 1.3f)` but runs in a smaller CI pixel window, so
the previous step did not guarantee `Nursing Rooms` was visible and the "never entered Nearby" and
"Nearby was closed" cases were conflated. Each cycle now starts with
`onNodeWithText("Nursing Rooms").performScrollTo().assertIsDisplayed().performClick()`, then waits for
idle and asserts `selected.size == cycle + 1 && nearby.value` with `closeCalls` in the message. All
later state/position assertions and diagnostics are unchanged; no `semanticsClick` bypass, no sleep,
no relaxed numeric assertion.

**Green (local, after this change)** — `panels-aosp-20260922-101137.log`: `OK (15 tests)`, 15 pass / 0
fail / 0 skip, including `HomePanelStabilityTest`. This confirms the entry precondition locally; it
does **not** pre-announce that the CI Nearby failure is fixed. CI verification waits for the pushed
commit.

## Unconfirmed / not accepted

- CI `42460c7` and CI `35661794312` (both API 36): `HomePanelStabilityTest` failed to find
  `PaneTitle = NEARBY`; API 26 was skipped on a dependency job failure. The same case passed locally
  on AOSP (both before and after the diagnostic change), so it is **not stably reproduced** and is not
  treated as fixed.
- `backend-aosp`: the in-app run failed with an Android `ApiFailure.Network`. The local QA gateway and
  Rust backend real login/logout were just verified with the generated Alice, and an emulator `nc`
  HEAD to the gateway returned 200. Server/favourite logic is therefore **not** claimed broken; the
  network path stays open.
- `loaded-aosp`: no complete result.
- Physical-device heading, speech, permission dialogs and manual visual acceptance are **not accepted**
  (Mac locked).

No credentials, cookies or absolute private paths are recorded here.
