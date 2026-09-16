# lycoris-map.com deployment

The new frontend is deployed to the independent Cloudflare Pages project
`lycoris-map-web` using dashboard Direct Upload. Its custom domain is
`https://lycoris-map.com`; its Pages hostname is `lycoris-map-web.pages.dev`.
The existing projects and `lycoris.online` DNS were not changed.

## Build and upload

From `frontend/`, run `pnpm build`, then copy only `_worker.js`, `_routes.json`
and `_headers` from this directory into `dist/`. Upload the **contents** of
`dist/` (or a ZIP with `index.html` at its root) through the project's Create
deployment page. Do not upload this test file, source tree, `.env`, local test
credentials, or server data. `node --test deploy/cloudflare/worker.test.js`
checks the deployment proxy independently of the application tests.

Pages serves the SPA, including `/admin/*` deep links. Only `/api`, `/uploads`
and `/health` routes invoke the Worker, forwarding to
`https://api.lycoris-map.com` with original paths and queries. It preserves
browser Origin and authentication, streams bodies, does not follow upstream
redirects, and marks proxied responses private and uncacheable. The fixed
backend origin is server-side and is not embedded in the browser bundle.

## Deployment record — 2026-09-16

- Application source: `88fbb4af3d3e6ea3925ab6fee9bdd2d241daa06d`.
- Deployment proxy: `9f5f6f9`.
- All 21 artifact files uploaded and Cloudflare reported deployment success.
- Cloudflare created the apex CNAME to `lycoris-map-web.pages.dev`.
- Chrome rendered the application and OSM tiles at the HTTPS custom domain.
- `/` and `/admin/review` returned HTTP 200 HTML.
- `pnpm build` passed, including strict TypeScript checks. The existing main
  bundle size warning remains. All three proxy tests passed.

## Backend pending

The designated server `43.155.130.105` (`lhins-oszy3oc8`, Seoul) was inspected
read-only through Tencent Cloud's terminal. It is an empty Ubuntu server:
no Rust service, database, Docker, Nginx or Caddy was running. No server software
or data has been changed by this deployment. The choice between a new empty
database and importing designated production data is awaiting the owner.

Consequently, login, point loading, contributions and uploads are not yet
available. The live `/health/ready` check returns HTTP 530 because the upstream
hostname is not configured. This is **frontend publication**, not completion
of backend deployment or end-to-end acceptance.

To finish the backend, establish the approved production database and uploads,
deploy the Rust service, create `api.lycoris-map.com` for this server, and install
a valid HTTPS certificate. Keep PostgreSQL, Redis and the Rust listener private;
proxy through the web server. Set `WRITE_ALLOWED_ORIGINS` to include
`https://lycoris-map.com`, `SESSION_COOKIE_SECURE=true`, and leave the session
Cookie domain empty so the same-origin Pages proxy works. Do not reuse the
local synthetic runtime or the release rehearsal Compose defaults in production.
Complete read-only API/health checks and user-approved account verification
after the service is ready.
