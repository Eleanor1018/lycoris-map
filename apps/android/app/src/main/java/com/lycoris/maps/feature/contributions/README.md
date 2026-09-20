# Native contribution persistence and uploads

Manual Application container wiring (use the same instances for UI and workers):

```kotlin
val draftDatabase = ContributionDatabase.open(application)
val draftStore = RoomDraftStore(draftDatabase.drafts())
val draftLocks = DraftLocks()
val photoImporter = PhotoImporter(application)
val contributionTransport = AccountContributionTransport(accounts)
val contributionEngine = ContributionEngine(draftStore, draftLocks, contributionTransport, photoImporter.files)
val contributionScheduler = WorkContributionScheduler(application)
val contributions = ContributionCoordinator(
    accounts, draftStore, draftLocks, photoImporter, contributionEngine, contributionScheduler, appScope,
)
```

The Application implements `androidx.work.Configuration.Provider`. Its lazy configuration uses
`Configuration.Builder().setWorkerFactory(ContributionWorkerFactory { container.contributionEngine }).build()`.
Remove only the `androidx.work.WorkManagerInitializer` metadata from the merged
`androidx.startup.InitializationProvider` (tools:node="remove"); retain other initializers.
Do not call `WorkManager.initialize` as well. Container construction must not eagerly evaluate
`WorkManager.getInstance`; the scheduler deliberately defers it until scheduling.
Keep `ContributionWorker` class names across releases (`-keepnames class
com.lycoris.maps.feature.contributions.ContributionWorker`) because queued work stores the name.
Official references: [custom initialization](https://developer.android.com/develop/background-work/background-tasks/persistent/configuration/custom-configuration),
[WorkerFactory](https://developer.android.com/reference/androidx/work/WorkerFactory),
[constraints and backoff](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work).

UI binds `contributions.drafts` and `storageProblem` using lifecycle collection. Drafts are filtered
by exact verified API origin/public owner and cleared on session transitions. Every command is
suspending; it runs on IO and cancels if its captured account epoch changes. UI must also hide all
private screens immediately when `accounts.state.user == null`. Store only `draft.id` in navigation
saved state, never copy a stale draft across account changes.

- `createDraft(lat, lng, language, original?)` uses immutable WGS84 coordinates. Pass `original`
  for edits, using its exact coordinates. On each field change call non-suspending `enqueueFields(id,
  fullFieldsSnapshot)`. Its Application-scoped FIFO retains the final characters across form closing
  and Activity recreation, and pins the identity captured when enqueued. `flushFields(id)` is a
  persistence barrier; `submit` calls it before taking any lock. Do not launch cancellable/debounced
  writes from a Composable. A failed field write publishes `storageProblem` and prevents submission.
  `updateFields` is also available for already serialized suspending callers.
- Photo Picker: `PickVisualMedia(ImagesOnly)` -> `importPhoto(id, uri)`. Android content URI is copied
  immediately while its grant is alive, bounded and sampled, orientation applied, pixels reencoded
  as JPEG without original metadata. No persistent content grant is needed for resumed uploads.
- Avatar UI may use `PhotoImporter.importPhoto(uri)`, `files.verify(photo)`, then delete its temporary
  photo in a cancellation-safe finally after avatar upload. Returned photo ownership belongs to the
  caller; cancellation before returning cleans the file.
- `submit` freezes the exact UTF-8 JSON before the first mutation. New marker creation runs in durable
  WorkManager. An edit PATCH runs once, after an EDITING checkpoint. Photo-only edit skips PATCH.
- `retry` is available only for idempotent create/upload states. UNCERTAIN_EDIT must display a clear
  "submission outcome unknown; check My contributions" state and has no Retry/Submit button.
  COMPLETE means submitted/pending review, never published or approved.
- `canReplacePhoto` permits a new photo after missing/expired/rejected upload. New bytes get a new
  UUID/hash/session while the existing marker receipt is retained. Do not recreate the point.
- Closing the form preserves the draft. `discard` cancels its scheduled work and removes local bytes
  and record; it does not withdraw or delete anything already submitted to the server.

The Room file and encoded images reside in `noBackupFilesDir`, to avoid restoring account-bound
receipt IDs without the corresponding session. Room uses compare-and-swap revisions and no
fallback-to-destructive-migration. Keep schema exports for future migrations. The shared mutex
coordinates local form and worker changes; Room CAS is the final stale-write guard.

Each HTTP operation rechecks the exact authenticated epoch inside AccountRepository's gate;
backoff never holds the session mutation gate. Owner changes cancel tagged jobs, preserve paused
checkpoints, and resume only when the original owner is authenticated again. WorkData contains
only opaque UUID; no cookie, source URI, coordinates, or image data.

Receipts are validated for upload UUID, marker ID, file size, 262144-byte chunk size, monotonic aligned
offset, and status. Resume GET precedes file validation; a completed server receipt remains
successful even if local bytes disappeared. Progress only follows validated server receipts.
409 performs bounded reconciliation; repeated no-progress pauses. 408/429/network/5xx retry with
exponential WorkManager backoff, up to six durable attempts. 401 requires authentication; 410 needs
new photo selection. A completion lost in transit is reconciled before any repeat completion.
No uncertain PATCH is automatically replayed, including process death between send and receipt.

JVM tests cover protocol safety, hashes, validation, frozen request replay, and interrupted edits.
Device acceptance additionally needs: real Room close/reopen, image orientation/EXIF stripping,
Photo Picker grants/cancellation, and WorkManager constraints/process death across an emulator
restart. Do not mark these device checks complete based on JVM tests alone. All test requests
must use the synthetic QA origin, never production writes.
