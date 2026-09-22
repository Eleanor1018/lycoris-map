# Shanghai database and original-image copy — 2026-09-23

This operation creates a **one-time private copy** of the existing service's
complete application database and original images. Korea remains the production
write authority. It is not a production cutover, a public launch, or continuous
replication. New writes in Korea after the exported snapshot are not included.

## Execution status

**Completed on September 23, 2026 (Asia/Shanghai).** The bundle passed SHA-256
verification on the Mac and Shanghai. The complete dump and originals were
restored to the new isolated state below. All nine table fingerprints, migrations,
owners, identity sequences, indexes, constraints and all 265 original-file hashes
passed verification before the app switched. Shanghai's app was recreated at
`2026-09-22T19:04:02Z` (03:04 September 23 local time) and became healthy.

The imported database contains 289 publicly visible approved places and 95 other
records. The private HTTPS API returns exactly those 289 IDs and excludes the
other 95. Detail, search, nearby, viewport, original-image and regenerated
thumbnail/detail requests passed. A sampled nonpublic original remains HTTP 404
for anonymous readers; account and admin routes remain HTTP 401 without a login.
UID/GID 10001 can read/write the new media directory.

A fresh headless Chrome profile rendered a real Shanghai place's detail/photo
and 14 visible place pins, with 35 loaded map tiles, TLS 1.3, no JavaScript page
errors and no HTTP 5xx responses. The browser's hostname mapping was limited to
that profile and the private SSH tunnel. Evidence is retained privately as
`restore-verification.json`, `activation.json`, `http-acceptance.json`,
`browser-acceptance.json` and `shanghai-detail.png` alongside the backup; these
files and database/media archives are not committed to Git.

Source readiness still reports PostgreSQL/Redis OK; its app start time stayed
`2026-09-22T10:40:38Z`, with no source app restart or production cutover. All four
Shanghai containers are healthy, and the app has live connections to the import
database. HTTP, HTTPS, Rust, PostgreSQL and Redis remain loopback-only; only SSH
listens on public interfaces. No actual user's password was changed or used to
log in for this verification, and no email was sent.

The captured inventory is:

| Table | Rows |
| --- | ---: |
| `users` | 62 |
| `map_markers` | 384 |
| `marker_favorites` | 5 |
| `marker_edit_proposals` | 98 |
| `marker_image_proposals` | 223 |
| `map_marker_translations` | 359 |
| `marker_image_uploads` | 1 |
| `_sqlx_migrations` | 7 |
| `spatial_ref_sys` | 8,500 |

The media archive contains **265 original files**. The snapshot has 238 distinct
nonempty media references, with zero missing or external/unsupported references.
Unreferenced original files can be retained in this archive; image references
and physical file counts are not expected to be equal.

## Locations and retained state

| Purpose | Location |
| --- | --- |
| Source backup on Korea | `/opt/lycoris/backups/shanghai-copy-20260923` |
| Destination backup on Shanghai | `/opt/lycoris/backups/shanghai-copy-20260923` |
| New Shanghai database | `lycoris_import_20260923` |
| New Shanghai originals | `/opt/lycoris/data/uploads-import-20260923` |
| Existing Shanghai database, retained | `lycoris` |
| Existing Shanghai uploads, retained | `/opt/lycoris/data/uploads` |
| Pre-switch configuration backup | `/opt/lycoris/backups/before-data-copy-20260923` |
| Executed Shanghai restore/switch scripts | `/opt/lycoris/backups/shanghai-copy-tools-20260923` |
| Shanghai application configuration | `/opt/lycoris/private/app.env` |
| Shanghai deployment pins | `/opt/lycoris/private/deploy.env` |

The source PostgreSQL container is `lycoris-production-postgres-1`; the target is
`lycoris-shanghai-postgres-1`. Both use PostgreSQL 17.11 and PostGIS 3.6.4.
Application tables and their identity sequences belong to `lycoris`; PostGIS
objects belong to `postgres`. Shanghai keeps its existing local role passwords.

Backup archives contain private account and contribution records. Keep them in
root-only directories, transfer through SSH, and never place them in Git, web
roots, build contexts or public object storage. Do not print database contents,
password hashes, connection strings or SMTP credentials in acceptance logs.

## Why the online copy is consistent

[`copy-snapshot.py`](copy-snapshot.py) keeps an exporting PostgreSQL transaction
open while `pg_dump`, table fingerprints, migration history and media-reference
queries use the same `REPEATABLE READ READ ONLY` snapshot. It does not stop or
modify the source service. No source DDL or out-of-band media deletion should run
during capture; the source audit found no relevant cleanup cron/timer.

Original files receive unique names and are atomically persisted before their
database references commit. Application operations do not overwrite originals
or delete previously committed originals. The only application deletion removes
a new uncommitted file after a failed resumable-upload transaction. Therefore,
copying originals after the database dump still includes the snapshot's files.
The archive hashes exactly the bytes it writes and rejects unexpected symlinks
or files changing during capture. A capture error is a failed backup, not a reason
to omit a referenced file.

Resumable upload bytes are in `marker_image_uploads.staged_bytes`, not a separate
chunk directory. Progress, completion receipts and image proposals are covered
by the database snapshot. The original 24-hour upload expiry remains in effect;
this copy does not extend an upload's lifetime. `.tmp-*` files and regenerable
`.renditions-v1` caches are excluded.

The executed source script recorded `summary.json.capturedAtUTC` after capture
finished. That field is the **backup completion time**, not an exact snapshot
cutoff timestamp. Its `snapshot` identifier associates the database and manifests.
The updated script distinguishes `snapshotEstablishedAtUTC` and
`backupCompletedAtUTC` for future captures; do not rewrite the captured manifest.

PostgreSQL sequences are not MVCC data. Their values need not equal a separate
source read made under the same snapshot. Preserve the dump's sequence state and
verify that each restored next candidate exceeds the corresponding maximum ID.
Do not reset a sequence downward to make counters appear identical.

## Restore into isolated Shanghai state

The procedure below documents the restore. The batch is already active: do not
rerun these commands against its existing database or media directory. For a
future copy use a new batch name and recheck compatibility. Run commands in a
root Bash shell **on Shanghai**, after transfer and checksum verification,
with failure handling and a restrictive file-creation mask enabled as below.
Keep the imported database and media directory unused by any application until
the full verification passes. Do not run `initialize.py`, `--migrate`,
`--adopt-baseline`, `pg_restore --clean`, or `docker compose down -v` for this copy.

1. Confirm the target identity and verify the received bundle. Inspect the
   captured `contents.txt` before restoring; all required roles already exist.

   ```sh
   set -euo pipefail
   umask 077
   test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' lycoris-shanghai-postgres-1)" = lycoris-shanghai
   cd /opt/lycoris/backups/shanghai-copy-20260923
   sha256sum --check SHA256SUMS
   ```

2. Create a new database. Confirm its encoding and locale match the source;
   the deployment initialization uses UTF-8 and `en_US.utf8`. `createdb` must fail
   if the selected import name already exists: investigate rather than dropping
   an existing database automatically.

   ```sh
   docker exec lycoris-shanghai-postgres-1 createdb -U postgres \
     --template=template0 --owner=lycoris --encoding=UTF8 --locale=en_US.utf8 \
     lycoris_import_20260923
   docker exec -i lycoris-shanghai-postgres-1 pg_restore -U postgres \
     --dbname=lycoris_import_20260923 --no-acl --exit-on-error --single-transaction \
     < database.dump > restore.stdout 2> restore.stderr
   ```

   Restore the full dump, including PostGIS definitions and SQLx history. Keep
   object ownership from the archive; `--no-owner` is deliberately absent. No
   cluster-wide role dump or source role password is restored. Stop if restore
   reports an error and inspect its private log; never continue after a partial
   restore or ignore extension/ownership errors.

3. Inspect the media archive and extract only into the new, nonexistent directory.
   The archive produced by the capture script contains regular original files
   under `avatars/` and `markers/`, with no links. Do not extract a different or
   unverified archive as root. The new directory must not be an existing symlink.

   ```sh
   tar -tzf uploads.tar.gz > media-archive-contents.txt
   test ! -e /opt/lycoris/data/uploads-import-20260923
   test ! -L /opt/lycoris/data/uploads-import-20260923
   install -d -o 10001 -g 10001 -m 0750 /opt/lycoris/data/uploads-import-20260923
   tar --extract --gzip --file=uploads.tar.gz --no-same-owner \
     --directory=/opt/lycoris/data/uploads-import-20260923
   chown -R 10001:10001 /opt/lycoris/data/uploads-import-20260923
   find /opt/lycoris/data/uploads-import-20260923 -type d -exec chmod 0750 {} +
   find /opt/lycoris/data/uploads-import-20260923 -type f -exec chmod 0640 {} +
   ```

   The executed `restore-target.py` applied stricter archive validation before
   extraction: manifest inventory and sizes, regular files only, exactly two
   path components under `avatars`/`markers`, and Python's `data` extraction
   filter. It then assigned the modes/ownership above. Its private execution
   copy is retained with the batch tools.

4. Run the verifier from the release's `backend/deploy/shanghai` directory,
   before starting an application against the imported state. Keep its result
   with the private backup. Run Python without optimization; the verifier rejects
   `-O`/`PYTHONOPTIMIZE` because validation assertions must remain enabled.

   ```sh
   python3 verify-copy.py \
     --backup /opt/lycoris/backups/shanghai-copy-20260923 \
     --database lycoris_import_20260923 \
     --uploads /opt/lycoris/data/uploads-import-20260923
   ```

   Verification covers the exact table inventory, row counts and SHA-256
   fingerprints; SQLx checksums and success flags; table and identity-sequence
   owners; sequence dependencies and next-ID safety; valid indexes and validated
   constraints; and exact original-file inventory, sizes, hashes and references.
   Serialization uses the same UTC/date/bytea/float settings, full-row JSON and
   `COLLATE "C"` ordering as the source. Do not substitute a differently formatted
   SQL export when comparing fingerprints.

## Switch only the private Shanghai application

After verification, preserve the previous private configuration with restrictive
permissions. Change only:

- The database-name component of `DATABASE_URL` in `app.env` to
  `lycoris_import_20260923`. Retain Shanghai's local role, password, host and port.
- `LYCORIS_UPLOAD_ROOT` in `deploy.env` to
  `/opt/lycoris/data/uploads-import-20260923`. Compose mounts it at the unchanged
  container path `/var/lib/lycoris/uploads`; `UPLOAD_DIR` stays unchanged.
- `SESSION_NAMESPACE` and `MARKER_CACHE_NAMESPACE` to new Shanghai import-specific
  values. This prevents old private-test sessions and empty-database query caches
  from being reused. Email-code storage also derives from `SESSION_NAMESPACE`.

Retain Shanghai's cookie name and current private Origin allowlist, local Redis,
rate-limit namespace, administrative second-factor setting/hash, administrative
reset default, email-verification secret and independent `smtp.env`. Do not copy
Korea's Redis, runtime configuration, verification challenges or signing secrets.

Validate without printing expanded secrets and recreate only the application:

```sh
docker compose --env-file /opt/lycoris/private/deploy.env config --quiet
docker compose --env-file /opt/lycoris/private/deploy.env up -d --no-deps --force-recreate \
  --wait --wait-timeout 90 app </dev/null
```

An ordinary container restart does not reload environment files or bind mounts.
The PostgreSQL volume, initialization settings, existing roles, Redis instance,
Nginx and frontend do not need replacement. PostgreSQL's healthcheck only checks
server availability; the application's readiness and startup migration check
must also succeed against the new database.

Validate public place/detail/search responses, an original image and a generated
rendition, unauthorized protected requests, and the private gateway's health.
Check that application UID 10001 can read and write its media directory; root-only
hash verification cannot establish application access. Existing accounts use
their captured passwords but need a new Shanghai login. Do not alter a real
account password or send real email merely to make a smoke check pass.

The exact-directory verifier is intended for the quiescent imported state.
Once the application runs, new rendition files or private test writes can make
that comparison differ legitimately. Retain its pre-start result; subsequent
media checks should verify the captured originals without requiring the live
directory to contain no additional files.

## Rollback and remaining limits

If startup or smoke verification fails, restore the previous private application
and deployment configuration and recreate only the app container. This returns
it to database `lycoris` and the previous uploads path. Retain the imported DB,
originals and logs for diagnosis; do not drop databases, erase volumes, overwrite
the source, or discard any post-import private edits. Rollback does not merge
those edits into the old database.

For this batch, `before-data-copy-20260923` retains `app.env`, `deploy.env`,
`compose.yml` and `nginx.conf`. Restore the first two to `/opt/lycoris/private/`
and `compose.yml` to `/opt/lycoris/releases/887ae40/backend/deploy/shanghai/`,
validate with `config --quiet`, and recreate only `app` with the command above.
Nginx was not changed by this data copy. The executed switch script also contains
an automatic restoration of these three files if Compose validation/startup fails;
that failure path was not needed or exercised during this successful activation.

This copy preserves accounts, bookmarks, moderation history, translations,
deactivated/private places, original images and resumable-upload records as
captured. It does not merge later changes in either region. Keep Korea as the
production write authority until a separate synchronization/cutover procedure
is implemented and tested.

Registration and password-recovery email delivery remain a separate transport
configuration task if Shanghai SMTP is still unset. A successful database copy
or ordinary password login does not prove that mail delivery works. Public
listeners, DNS routing, ICP/public-security filings and regional synchronization
are outside this operation; the Shanghai gateway remains private.
