# lycoris-map.com backend

Linux production deployment on the designated Tencent Lighthouse server,
43.155.130.105. The app and Caddy use the host network; PostgreSQL and Redis only
publish loopback ports. Only HTTP/HTTPS should be opened in the cloud firewall.
The app runs as UID 10001 with a read-only root and persistent uploads.

Run Compose as root from this directory. Keep all actual configuration under
`/opt/lycoris/private` (0700), data under `/opt/lycoris/data`, and private backups
under `/opt/lycoris/backups`. Never commit any of those directories. Credentials
are generated once by `prepare.sh EXISTING_ADMIN_ENV`; it refuses replacement.
The admin BCrypt hash and reset default are imported from the previous service.
The Rust admin second-factor check is enabled. New domain cookies are Secure,
HttpOnly, host-only; old Java sessions are not imported into the new Redis.

The source is PostgreSQL 17.8 / PostGIS 3.6.2. This image keeps PostgreSQL 17,
updating its patch version and PostGIS to the already-rehearsed 3.6.4 package.
Images and Rust dependencies are pinned. Build the app with one compiler job on
the 2GB host. Do not use compose.release.yml or synthetic test data in production.

Before restoration, verify SHA256SUMS and retain the original database dump,
roles, container configuration, Redis snapshot and upload archive. Restore into
the new database only, using pg_restore --no-owner --no-acl --exit-on-error, then
assign application tables/sequences to lycoris; keep PostGIS owned by postgres.
Compare table fingerprints and every media checksum before applying migrations.
Run app --check-baseline, app --adopt-baseline, then app --migrate explicitly.
Starting the app never executes migrations automatically.

Keep the old service available during preparation. For the final transfer, stop
its writer, create a fresh consistent database/media backup, validate the new
copy, migrate and start the Rust service. Retain the old database and media for
recovery. Never start both writers against independent copies after cutover;
new writes must be preserved before any rollback.

`api.lycoris-map.com` points to the new server; Caddy obtains/renews its HTTPS
certificate. Cloudflare Pages forwards the primary domain's /api, /uploads and
/health routes. Caddy only trusts Cloudflare's published IP ranges for client IP
headers and overwrites X-Forwarded-For before passing it to the loopback Rust
listener. See [Caddy proxy options](https://caddyserver.com/docs/caddyfile/options)
and [Cloudflare IP ranges](https://www.cloudflare.com/ips/).

## Production cutover — 2026-09-16

Deployed through the Tencent Cloud Chrome terminal to `lhins-oszy3oc8`.
The Rust image is `lycoris-backend:ed88782`; PostgreSQL is
`lycoris-postgres:17.11-3.6.4`. The application, PostgreSQL and Redis health
checks pass. Caddy has a valid Let's Encrypt certificate; the API DNS record
is proxied and Cloudflare encryption is Full (strict). PostgreSQL, Redis,
the Rust listener and the Caddy administration endpoint bind to loopback.

The previous Java container on `207.57.131.13:64307` was stopped before the
final snapshot. It remains stopped with `unless-stopped` restart policy.
Its original database, uploads and container are retained. Old-domain DNS
and redirects were not changed. Do not start that writer while this service
is accepting writes; rollback now requires reconciling new production data.

Both the preflight and final `cutover` backup contain the custom PostgreSQL
dump, roles, previous container configuration, admin settings, Redis snapshot,
table fingerprints and media archive with per-file hashes. Final copies:

- Old server: `/opt/lycoris-backups/migrate-20260916/cutover`.
- New server: `/opt/lycoris/backups/cutover`.
- Owner's Mac: `work/backend-production-private/cutover` under the deployment
  workspace. This private directory is outside the Git worktree.

All eight backup checksums match across copies. The six original tables were
compared before migrations using the source's Asia/Shanghai timestamp rendering:
61 users, 383 markers, 2 favorites, 98 edit proposals, 222 image proposals and
359 translations. All 264 media files match their source hashes. Restoration
and all migration steps were first rehearsed in the separate `lycoris_review`
database. The production database has SQLx migrations 1, 2 and 3 applied.
`restore-backup.sh BACKUP_DIRECTORY lycoris_review` documents the verified
restore procedure and refuses a destination containing application tables.

Verified through `https://lycoris-map.com`: ready health, public list (360
visible markers), search, nearby, viewport, detail and an image download all
return HTTP 200. All 209 public image references resolve to migrated files;
the downloaded sample matches its backup hash. Anonymous account/admin reads
and an empty login correctly return 401. Chrome displayed the real nearby
list, point details and migrated photograph. The application UID 10001 can
write the upload directory. Real-account login and authenticated contribution/
upload flows were not exercised against production data during this deployment.

Existing account hashes and IDs were preserved; old Java sessions were not
restored, so users must sign in again on the new domain. Backup files contain
private data and must remain outside source control and frontend artifacts.

The source contains one duplicate active username group and one duplicate
active case-insensitive email group. They were preserved unchanged. Rust
deliberately rejects ambiguous login identities; resolving these records
requires the owner's account-ownership decision, not an automatic merge.

## Old server retired — 2026-09-17

The old host `207.57.131.13` is no longer a Lycoris runtime. The stopped
`lycoris-backend` container now has restart policy `no`. Nginx, Redis and
PostgreSQL were stopped and disabled; PostgreSQL 17's cluster `start.conf` is
`manual`. A final listener check showed only SSH on port 64307. The machine
remains accessible for the owner's later reuse; no VM, volume, database,
uploads or backup was deleted.

All eight final migration backup checksums were rechecked successfully before
retirement. Redis was saved before shutdown. Previous Nginx configuration and
PostgreSQL cluster startup configuration were copied into the root-only
`/opt/lycoris-backups/retired-20260917/`. Migration backups remain in the three
locations recorded above. Do not turn the obsolete data copy into a writer:
the new server has accepted production writes since the September 16 cutover.

After stopping the old stack, `https://lycoris-map.com/health/ready` still
returned PostgreSQL and Redis healthy. The new backend on `43.155.130.105`
was not restarted or modified during retirement.
