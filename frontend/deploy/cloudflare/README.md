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

## Mobile sheet P0 hotfix — 2026-09-16

Commit `eecff63` restores dragging from the panel header and content, expands the
handle hit area to its full row, and separates touch cancellation from the
browser's companion pointer cancellation. Expanded content retains native
scrolling; a downward drag at the top collapses the panel. Form inputs retain
native editing. Drag release uses bounded momentum and a short settling
transition, with reduced-motion support. Interrupted gestures cancel cleanly;
collapsing restores the content to the top and drag gestures do not click cards.

Validation: all 233 frontend tests passed (including nine gesture regressions),
strict TypeScript and the production build passed, and changed files passed
format checks. Chrome's iPhone 16 Pro Max touch emulation verified the complete
collapsed → half → full → half → collapsed sequence both locally and at the
production custom domain. Physical-device Safari was not tested in this run.
Cloudflare reported deployment success, and the live HTML references
`index-DGjWsXvp.js` and `index-p4JTL1Pr.css`. Backend availability remains as
recorded above; no backend or old-domain changes were part of this hotfix.

## Mobile sheet P2 fixes — 2026-09-16

Commit `fe193d6` anchors mobile panels to the viewport bottom, including account
and contribution sheets. Safe-area spacing is inside the scrollable content;
the expanded panel retains its 46px top offset. Drag limits and map attribution
positioning use the same updated geometry. Secondary mobile panels now have a
visible upper-right close icon, including settings, Nearby, bookmarks, details,
and all account views. Existing contribution and desktop close controls remain.
The new mobile controls have a 44px hit area and reuse the existing Figma icons.

Validation: all 241 frontend tests and the strict TypeScript production build
passed. Regression coverage checks closing every settings option, Nearby and
place details with focus/list restoration, and cancelling mobile login/register.
Chrome iPhone 16 Pro Max touch emulation verified the bottom alignment and close
controls locally, plus the retained full-to-half drag. The custom domain was
checked after deployment for full-height alignment, closing settings and login.
Physical-device Safari was not tested in this run.

Cloudflare reported success after uploading all 21 production files. Live HTML
references `index-BmFrJzOL.js` and `index-DwCxC-gV.css`. This release only changes
the frontend; backend availability remains as documented above.
