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
