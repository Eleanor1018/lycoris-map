# Nearby list correction — 2026-09-22

## Problem and behavior

The Android `SecondaryPage.NEARBY` branch inserted `NearbyCategories` above the
actual `placeItems` result list. At the middle sheet height, users saw the same
three category cards again and the results/status were below them. The existing
smoke test asserted only page/category selection and did not reject this repeated
chooser.

The Explore page retains its three category cards. Selecting one now opens the
Nearby title and close button, selected category and configured radius, then the
existing loading/error/empty state or actual place rows. The redundant category
chooser is removed. This follows the Web `NearbyResults` and iOS `NearbyResultsView`
structure. Closing returns to Explore. Result selection and retry keep their existing
ViewModel/repository paths; no server or database writes are part of this change.

## Checks

- 147 JVM tests and Android QA lint passed; QA and instrumentation APKs compiled.
- New repository coverage checks all three category query values, coordinates,
  a custom 1500 m radius, language, empty versus failed results, retry recovery,
  and a slow earlier category response not replacing the current result.
- The real-Activity smoke test now rejects clickable category cards on the result
  page, checks the selected category/configured radius, and checks all three cards
  return after closing. It does not assume a backend is online.
- The existing fractional-density panel stability fixture now models the result
  subtitle instead of repeating the chooser; its loading/empty/long-list assertions
  remain unchanged.
- Read-only production API check at 31.2304, 121.4737, radius 1000 m returned HTTP 200
  for all three categories: two accessible toilets, no nursing rooms, no medical
  institutions. Android and Rust agree on `/api/markers/nearby` and query names.
  These empty responses are valid for that coordinate/radius, not evidence of a
  loading error.

## Separate rotation investigation

Run [35709610088](https://github.com/Eleanor1018/lycoris-map/actions/runs/35709610088)
(commit `65840e2`, before this Nearby fix) passed the API 36 suite. API 26 still
failed its orientation-idle test: the new Activity was resumed/focused, the Compose
view was attached and had no pending measure/layout at the sampled instant, but
recomposer changeCount grew from 15 to 1099 during the 26-second idle wait.
This narrows the problem to ongoing Compose work; it does not yet identify the
state feedback responsible or prove that physical phones freeze. The Nearby fix
makes no claim to fix rotation. No timeout relaxation or test skip was added.

## Completed CI and signed package

[Run 35712094800](https://github.com/Eleanor1018/lycoris-map/actions/runs/35712094800)
for `445e4d5` passed JVM/lint/build/alignment and API 36: 64 methods, 59 passed,
5 explicitly opt-in integration checks skipped. The Nearby entry/close regression
and fractional-density result-list regression both passed. They also passed API 26;
that suite still has only the independently tracked orientation-idle failure.

Local `nearby-aosp-20260922-174134` passed the panel stability method but the real
Activity method failed in teardown waiting for `DESTROYED` (last `STOPPED`); no
Nearby body assertion failed. The run took 467 seconds during overlapping host
builds. This local failure is recorded rather than counted as a pass or attributed
to resource pressure without evidence. Computer Use visual acceptance remains
blocked by the Mac lock.

A follow-up test-only matcher distinguishes a single-label category button from
an actual place row that also contains the same Chinese category label. It does
not change the APK's application code. After the release build completed, the
updated instrumentation APK compiled and local `nearby-aosp-20260922-180158`
passed both methods (83.412 seconds, no failures/skips), including Activity
teardown. The earlier failure remains documented above.

The signed release APK uses `com.lycoris.maps`, version `0.1.0`, the existing release
certificate, production API, and configured Tencent/Tianditu sources. It is not
debuggable; signature and 16 KB ZIP alignment checks passed and all 13 bundled SVG
icons are present. APK size: 99,009,825 bytes. SHA-256:
`c36005e69a8334210bf8bb1a0970d5d98f560b7474d87c2e4622d51ea834c54e`.
The package includes the Nearby fix; it is not evidence that rotation is fixed.
