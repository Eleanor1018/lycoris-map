# Android audit — 2026-09-21 / 2026-09-22

## Follow-up on September 22

Current product baseline: `d0601cb` on the visible `feat/android-native` checkout. The sections below
this follow-up retain the earlier investigation history; they are not the latest acceptance status.

| Check | Latest evidence |
| --- | --- |
| JVM, lint, QA and instrumentation build | 144 JVM tests passed; lint and builds passed |
| Full API 36 CI | `35699537525`: 58 passed, 5 opt-in tests skipped, no failures |
| Full API 26 CI before fixture correction | Same run: 56 passed, 2 failed, 5 skipped |
| Isolated native backend | `backend-aosp-20260922-152104.log`: passed; login, encrypted session restore, favorites, idempotent creation and chunked upload |
| Loaded detail rotation | `loaded-aosp-20260922-152623.log`: 1 passed; actual QA detail loaded, Activity recreated both ways, user camera retained |
| Live provider cases | `online-aosp-20260922-152720.log`: 3 passed; OSM, Tianditu and Tencent rendered and recovered from background |
| Backend stage diagnostics | 35 Python guard tests passed; updated native backend case passed again in `backend-aosp-20260922-154233.log` |
| Cold-start keyboard regression | Local AOSP 36: `startup-aosp-20260922-154755.log`, 1 passed |

The backend runner's database oracle found exactly one created marker and one image proposal, with
763045 uploaded bytes. The earlier generic `ApiFailure.Network` did not recur; its cause remains
undetermined. These writes used generated accounts and the isolated local QA database only.

The provider run also checked Tianditu labels/overlays and Tianditu/OSM/Tianditu camera retention,
plus Tencent-to-OSM switching. OSM reported `LoadFromCache` for the center tile and zero network tile
loads; it proves cached rendering/lifecycle recovery, not fresh network reachability. Custom
instrumentation receipt bundles also use status 0, so raw status-0 line counts are not test totals.

API 26 logcat identified a separate environment fault at 03:35:37 UTC, before instrumentation began:
`com.android.statementservice` crashed while starting its App Links verification service from the
background. ActivityManager displayed its crash dialog. The later IME failure reported
`windowFocused=false`, `immActive=false`. This is a candidate cause of lost focus, not proof that
both configuration failures are fixed. MapLibre also logged `std::bad_alloc` after rotation;
that renderer observation must not be silently discarded if it persists.

CI fixture change `856e271` temporarily allows only this system verifier to start its service for
60 seconds around APK installation. App Links verification and crash dialogs remain enabled, and
Lycoris receives no exemption. API 26's
[service-start policy](https://android.googlesource.com/platform/frameworks/base/+/android-8.0.0_r1/services/core/java/com/android/server/am/ActivityManagerService.java)
includes the temporary device-idle allowlist. Window state is now saved before and after tests.
Re-verification run `35699537525` removed the system-verifier crash and its dialog, but API 26 still
failed: 47 passed, 12 failed, 4 skipped. Logcat now shows LatinIME opening as MainActivity starts,
before any search-field touch. This hides primary navigation via the existing IME-responsive layout,
so smoke/configuration tests fail to find their tabs. The opt-in loaded-detail case also failed in
its setup before reaching its skip. This run does not establish that configuration handling passed.

MainActivity now uses `stateHidden|adjustResize` to open the map without automatically showing the
keyboard; it does not use `stateAlwaysHidden`. A new real-Activity case observes platform frames
after window focus and verifies the untouched startup keeps the IME hidden and all three navigation
tabs visible. Existing touch-to-open-IME, first-Back, and rotation assertions remain unchanged.
This follows Android's [input visibility guidance](https://developer.android.com/develop/ui/views/touch-and-input/keyboard-input/visibility).
API 26/36 CI re-verification of this change is pending.

The backend integration test now emits bounded stage names with custom status code 2. The runner
reports `backendStage` on failures without copying arbitrary text; it preserves an explicit primary
failure over later cleanup, and attaches a secondary cleanup exception as suppressed. Existing
environment guards, required test count, receipt validation and database oracle are unchanged.

Still unaccepted: physical Xiaomi/realme reproduction, actual sensor heading, speech-service and
permission-dialog behavior. The AOSP 36 device has a Galaxy S25-sized display; it is not Samsung
hardware or One UI. Computer Use again failed to retain the floating Studio emulator as its input
target, so this follow-up does not claim manual visual/gesture acceptance.

## Earlier investigation

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
| `panels-aosp` (final) | 16 run: 16 pass, 0 fail, 0 skip — `panels-aosp-20260922-111329.log` |
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

CI `35680724883` / job `106596899228` (commit `555e268`): 143 JVM, lint, all APK builds and 16 KB
alignment passed; full API 36 had exactly one failure —
`HomePanelStabilityTest` line 102, `Close did not leave Nearby; cycle=0 selected=[baby_room]
closeCalls=0`. All held regressions and `newHandleDragInterruptsPreviousFling` passed. The earlier
`PaneTitle` lookup failure did not recur. API 26 was skipped because the API 36 job failed.

That failure means the click did not reach the close path: the test scrolled the Nearby title into
view but clicked `Close` directly, which does not guarantee the close target itself was in the
viewport. The close step is now a visibility precondition on the real target. Each cycle scrolls
`Nursing Rooms` into view, asserts the entry took effect, keeps the nearby stability assertions, then
scrolls and shows `Close` itself (`onNodeWithContentDescription("Close").performScrollTo().assertIsDisplayed()`),
records the close and root bounds, clicks, waits for idle and asserts `nearby.value == false` and
`closeCalls == cycle + 1` (failure message carries `closeBounds`/`rootBounds`), and finally verifies
`Find Nearby` with `performScrollTo().assertIsDisplayed()`. No sleep and no relaxed numeric assertion.
This is a test step to ensure the real target enters the viewport; it does not claim the close
behaviour is broken or fixed. Local green: `panels-aosp-20260922-111329.log`, `OK (16 tests)`. The new
step awaits CI re-verification.

## Not accepted

- `backend-aosp`: in-app run failed with Android `ApiFailure.Network`. The local QA gateway and Rust
  backend real login/logout were verified with the generated Alice, and an emulator `nc` HEAD to the
  gateway returned 200; server/favourite logic is **not** claimed broken and the network path stays
  open.
- `loaded-aosp`: no complete result.
- Pixel instrumentation: interrupted, no complete pass count.
- Physical-device heading, speech and permission dialogs are **not accepted**. Manual visual
  acceptance was initially blocked by the Mac lock. After unlock, Studio displayed the AOSP home
  screen, but Computer Use switched back to the editor during attempted emulator interaction and
  its surface inventory timed out. App gesture/visual acceptance remains incomplete.

## Font and icon packaging check

The app theme uses Material 3 `Typography()` (system fonts), and `FigmaIcon` reads SVG files from
`android_asset/figma`. All 13 source SVG assets are present in the tested QA APK. This rules out a
missing asset in that APK; it does not establish the cause of a physical phone's rendering failure.

No credentials, cookies or absolute private paths are recorded here.
