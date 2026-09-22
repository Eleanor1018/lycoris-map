# Android audit — 2026-09-21 / 2026-09-22

Baseline `feat/android-native` commit `42460c7`. Sue executed the checks and implementation; Wen
reviewed the evidence and corrected the test coordinates and Foundation API usage. Files touched:
`MapPanel.kt`, `MapPanelTest.kt`, `HomePanelStabilityTest.kt` and this report. No other production file
changed. Reviewed fixes are committed on `feat/android-native`; no production deployment is included.

## Totals

| Suite | Result |
| --- | --- |
| JVM (`unit`) | 143 tests, 0 failures / 0 errors / 0 skipped |
| Python guards (`guards`) | 29 tests, OK |
| Full AOSP instrumentation (baseline) | 60 run: 53 pass, 2 fail, 5 skip (skip code -4) |
| `panels-aosp` (final) | 16 run: 16 pass, 0 fail, 0 skip — `panels-aosp-20260922-104409.log` |
| Pixel instrumentation | interrupted; no complete pass count |
| `backend-aosp` | failed at instrumentation with `ApiFailure.Network`; open |
| `loaded-aosp` | no complete result |

The 5 AOSP skips are the expected opt-in cases (live OSM/Tianditu/Tencent, live backend, loaded-detail
rotation). The 2 AOSP failures are both in `AppConfigurationTest`: the IME test (field focused and
`immActive=true`, but `imeBottom=0` and `show_ime_with_hard_keyboard=0`, so no bottom inset) — **not
confirmed as a product defect** — and `actualOrientationRebuildRetainsPrimarySelectionCameraAndSelectedPlaceId`
(`ComposeNotIdleException`). No global keyboard setting or device proxy was changed; QA fixtures
were not reset and production data was not modified.

## Two confirmed root causes

**1. Content-height change during a held drag reset the offset.** `regression-aosp-20260921-220839.log`:

```
middleY=957.0 heldY=1056.0 afterResizeY=957.0 expected:<1056.0> but was:<957.0>
```

A held drag inside the LazyColumn reached 1056; when the result set grew while the finger was still
down, the header snapped back to the old middle detent 957. `MapPanel` now reads Foundation's real drag
signals (`handleInteractions.collectIsDraggedAsState()`, `scroll.interactionSource.collectIsDraggedAsState()`),
records the page/stop that owns the drag, and while that drag is active adds the measured `full` delta
to the previous finite offset and clamps into the new bounds in the same measured pass. The programmatic
`LaunchedEffect` no longer keys on `geometry`, so re-measurement cannot steal a gesture. Regressions:
`contentResizeDuringHeldListDragKeepsFingerProgress` and `contentResizeDuringHeldGrabberDragKeepsFingerProgress`.

**2. Grabber drag replayed the last delta.** Foundation 1.12.1 `AnchoredDraggableNode.drag` runs
`state.anchoredDrag { forEachDelta { ... } }`; its parent `DraggableNode` loops
`while (...) { (event as? DragDelta)?.let(processDelta); event = channel.receive() }`. A mid-drag anchor
change restarts `anchoredDrag`, re-processing the last `DragDelta` in `event` — the extra 40 px seen in
CI `35661794312` (`middleY=364 heldY=476 afterResizeY=516`). The outer `anchoredDraggable` is replaced
with Foundation's plain `draggable` + `rememberDraggableState { delta -> state.dispatchRawDelta(delta) }`;
the retained `userFling`/`defaultFling` still run, with a `ScrollScope` whose `scrollBy` only calls
`state.dispatchRawDelta`.

Local green after both fixes: `panels-aosp-20260922-100843.log`, `OK (15 tests)`.

## Fling hand-off protection (candidate, not a confirmed product bug)

The plain `draggable` runs `onDragStopped` in a separate coroutine; starting the retained fling outside
the state's mutate lock means a following `dispatchRawDelta` drag might not cancel it. This is a
protective check of the new animation hand-off, not a confirmed defect.

The test `newHandleDragInterruptsPreviousFling` uses a non-zero
`MotionDurationScale` implementation with `scaleFactor = 1f` in `createComposeRule(effectContext = ...)` (no global setting
changed, no v2 migration), settles layout before pausing `mainClock`, and only re-uses the paused clock
to keep the settle animation running. It re-fetches the grabber coordinates while the fling runs,
waits for idle after each clock advance before reading `headerY`, and treats two consecutive changing
frames as "the animation is still running" (`flingSecond > 1` is only a sanity check, not proof of the
exact endpoint). `up()` runs in `finally` only when a pointer is down.

The candidate fix wraps the `onDragStopped` fling in `state.anchoredDrag { ... }` and, when
`isUserDragging` becomes true, takes the lock with `state.anchoredDrag(MutatePriority.UserInput) {}` to
cancel the previous fling/`animateTo` before recording `dragControl`. The empty drag only takes the
lock; finger deltas still arrive through the plain `draggable`, so the event loop is not returned to
`anchoredDrag` and the 40 px replay does not recur. `newTarget` stays non-null; no existing assertion
changed.

**Negative control (`interrupt-aosp` runs only this method):**

- Candidate present: `interrupt-aosp-20260922-103952.log` — `OK (1 test)`.
- Candidate removed (both `state.anchoredDrag` wrappers temporarily dropped, other verified drag fixes
  kept): `interrupt-aosp-20260922-104038.log` — **FAIL** at "the second drag must move the sheet
  downward from the fling position".
- Candidate restored: `unit` passed, then `interrupt-aosp-20260922-104202.log` — `OK (1 test)`.

This shows the test can catch the missing-lock condition and the candidate removes it. It is a
protection check / source assessment, not a third confirmed product bug.

## Nearby test hardening

CI `35678649471` (commit `275d65b`): 143 JVM, lint, all APK builds and 16 KB alignment passed. API 36
had exactly one failure — `HomePanelStabilityTest`'s final `Find Nearby` `assertIsDisplayed` (the node
existed but was outside the on-screen area). The earlier `PaneTitle` lookup failure is resolved; the
entry/update stability assertions and both held regressions passed; API 26 was skipped on an upstream
dependency.

The current test closes by waiting for idle after `Close.performClick`, asserting the state left Nearby
and `closeCalls == cycle + 1`, then verifying the returned menu with
`onNodeWithText("Find Nearby").performScrollTo().assertIsDisplayed()`. Each cycle also scrolls
`Nursing Rooms` into view and asserts the entry took effect. These are state/reachability assertions in
the large-font fixture; they do not assume a title is immediately on screen. No sleep and no relaxed
numeric assertion. Local green: `panels-aosp-20260922-104409.log`, `OK (16 tests)`. The close
state/reachability change awaits a new CI run.

## Not accepted

- `backend-aosp`: in-app run failed with Android `ApiFailure.Network`. The local QA gateway and Rust
  backend real login/logout were verified with the generated Alice, and an emulator `nc` HEAD to the
  gateway returned 200; server/favourite logic is **not** claimed broken and the network path stays
  open.
- `loaded-aosp`: no complete result.
- Pixel instrumentation: interrupted, no complete pass count.
- Physical-device heading, speech and permission dialogs are **not accepted**. Manual visual
  acceptance was blocked by the Mac lock during the automated run and remains pending at this snapshot.

No credentials, cookies or absolute private paths are recorded here.
