# Contribution lifecycle

The Application container shares one `ContributionEngine`, `DraftStore`, and `DraftLocks` between Compose and WorkManager. Keep custom WorkManager initialization and the worker class name stable across releases; queued work stores that name.

Drafts and encoded photos live in `noBackupFilesDir` and are scoped to API origin and account. Room revision checks protect persisted state; the shared mutex serializes local form and worker changes. Navigation stores only the draft ID.

Field updates use an Application-scoped FIFO, and submission flushes it before freezing the request. Import selected photos while their URI grant is valid; retain only normalized, metadata-free image bytes needed for retries.

Creation persists its receipt before image work begins. Uploads reconcile server UUIDs, sizes, offsets, and completion before retrying. A completed server receipt stays successful even if local bytes have disappeared. Never recreate a place because its image failed.

An edit is sent once after an `EDITING` checkpoint. Process death or an uncertain response leaves `UNCERTAIN_EDIT` for reconciliation; it must not become an automatic PATCH retry. Completion means submitted for review, not published.

Every HTTP operation rechecks the authenticated account epoch. Account changes cancel private work; only the original owner can resume it. WorkData contains an opaque draft ID, not cookies or image contents. Discarding a draft removes local work and files, not already submitted server content.

Use JVM tests for protocol rules and isolated device tests for Room persistence, Photo Picker grants, image normalization, and WorkManager recovery. Automated writes belong to the QA backend.
