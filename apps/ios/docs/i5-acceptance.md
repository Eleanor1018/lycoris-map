# I5 — Native contribution, edits and photos

Date: 2026-09-16. Branch: `feat/ios-native`. Root implementation, with independent read-only contract and recovery reviews. No deployment, server synchronization, backend changes or merge into main.

## Shipped behavior

- Pen → login if needed → map selection → native contribution Form. The MapKit instance stays alive; the location is the coordinate under the physical screen-center target. Existing drafts can change location, and Cancel returns to the form. Existing-place coordinates cannot be edited.
- Figma `74:4744` was checked with MCP. Title, three categories, description, opening/closing time and optional photo map to SwiftUI controls under the user's latest fully native UI preference. No public/private field is added.
- Native DatePicker, PhotosPicker, navigation close/submit actions, keyboard dismissal, grouped sections, progress and confirmation dialogs. English and Simplified Chinese copy added without including unrelated pre-existing Xcode catalog changes in the commit.
- A single protected on-device draft survives dismissal and relaunch. The final orientation-correct JPEG (maximum 2048px, ≤5MiB) is atomically persisted before hashing/upload, excluded from backups, and reused byte-for-byte on resume.
- Create freezes UUID/payload before the first request. Recovery never changes either, including if a later recovery attempt is rejected. Saving a marker receipt precedes any photo request.
- Edit PATCH preserves content language and sends empty strings for cleared text/hours. Coordinates, computed activity and privacy are omitted. Photo-only edits skip PATCH. An unknown edit result persists as uncertain and requires explicit confirmation to resend.
- Upload start/receipt/chunks/complete reuse the Rust protocol. Receipts are validated for marker/session/size/offset/status. Recovery first reconciles the server, even if local image bytes are missing, because a lost completion response can already represent a committed proposal.
- Foreground/network restoration resumes safe writes with bounded exponential delay. A 409 reconciles progress before pausing persistent conflict; quota/other terminal errors pause; expiry or known photo rejection requests re-selection. Logout/account replacement purges and cancels local work. Every request shares the account mutation gate and validates owner, service origin and live epoch.
- Success explicitly says awaiting review. Original place text/image remains unchanged until approved; discarding local work cannot retract submitted proposals.

## Validation

Xcode 26.6, Swift 6.3.3, iOS 26.5; Swift 6 complete concurrency checking. Local simulator builds use ad-hoc signing for Keychain.

- Debug unit suite: **56 tests passed** in `/tmp/lycoris-ios-i5-final-unit.log`. The final recovery run passed **12 contribution tests**, including two additional preflight/corrupt-journal cases, in `/tmp/lycoris-ios-i5-recovery-final.log` (**58 distinct unit tests passed** across these runs).
- Cases cover lost create receipt with frozen payload, lost chunk/completion receipts across reconstructed stores, completed upload recovery without local bytes, no automatic ambiguous-edit replay, photo-only editing, logout/account-switch isolation, missing-file replacement, failed persistence before network, receipt validation and a delayed edit response attempting to replace a newer draft.
- Native UI acceptance on iPhone 17: login continuation, map selection, system photo picker, durable draft/photo after actual terminate/relaunch, creation and photo submission, My Places, fixed-location editor and pending edit proposal. `/tmp/lycoris-ios-i5-flow4.log`.
- The same complete native UI flow passed on iPhone 17 Pro in `/tmp/lycoris-ios-i5-pro-flow2.log`. Its initial run exposed a test-harness timing issue dismissing the native Save Password sheet; the helper now waits for dismissal before continuing and never saves the fixture credentials.
- The live test uses only the identified loopback synthetic Rust stack and a dedicated test-runner account. Backend readback confirms exactly one new marker for the tested title, PENDING status, no prematurely approved image, and unchanged original text after PATCH. No real credentials, locations or user photos are used.
- Release simulator build passed. `/tmp/lycoris-ios-i5-release.log`.
- Figma screenshot and native simulator captures inspected. Computer Use manually verified the Chinese form, native time controls, selection and cancel-to-draft return on iPhone 17 Pro after Xcode Run. XCTest supplied the complete deterministic submission flows. Curated captures are in `/Users/nora/Documents/Codex/2026-09-14/wen/outputs/ios-i5/`.

The early UI runs identified the pen's transparent hit area and keyboard-obscured photo control. The pen now has its full 48pt rectangular hit area; title Return and keyboard Done dismiss input. The complete flow passed after these fixes. Recovery review also corrected an old edit loading over a newer contribution intent and preflight errors falsely promising automatic edit retry.

## Boundaries

Transfers are foreground tasks with durable recovery, not guaranteed background URLSession execution. After force quit, they resume on the next verified launch. There is one local contribution at a time, and one optional photo per submission. The server has no cancel-upload or proposal-retraction API; local discard does not undo accepted writes.

Mock transport tests exercise lost-response and restart faults deterministically; they do not claim physical-radio or real-device background tests. Physical device coordinate alignment, signing, accessibility sweeps and release deployment remain the planned later-stage work. I6 settings/system experience and I7 shared device use are still pending.
