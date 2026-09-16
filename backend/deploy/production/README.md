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
