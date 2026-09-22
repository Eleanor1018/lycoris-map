# lycoris-map.com deployment

The production frontend is deployed by the existing Git-connected Cloudflare
Pages project `lycoris-main`. Its custom domain is `https://lycoris-map.com`;
its Pages hostname is `lycoris-main.pages.dev`. GitHub pushes to `main`,
including merged pull requests, automatically build and deploy the new
`frontend/`. Non-production branches produce previews. No new API token or
GitHub Actions secret is required: the existing Cloudflare GitHub installation
is reused. The dashboard still displays the repository's old name
`Eleanor1018/lycoris`, but follows the renamed `Eleanor1018/lycoris-map` repository
and its current commits.

## Automatic build configuration

The dashboard settings are part of the deployment configuration. Use these
values in both production and preview environments:

- Build system: version 3.
- Production branch: `main`; automatic deployments enabled.
- Preview branches: all non-production branches.
- Root directory: `frontend`; output directory: `dist`.
- `NODE_VERSION=24.19.0`; `PNPM_VERSION=11.19.0`.
- Build command:

```sh
pnpm test:unit && node --test deploy/cloudflare/worker.test.js && pnpm build && cp deploy/cloudflare/_worker.js deploy/cloudflare/_routes.json deploy/cloudflare/_headers dist/
```

Pages installs dependencies before running the command. `pnpm-lock.yaml` and
the declared tool versions pin the frontend dependency graph. A failing test,
proxy check or strict TypeScript build stops publication. Only `dist/` is
uploaded, including the three explicitly copied proxy configuration files.
Source files, `.env`, fixtures, private credentials and server data are excluded.
The same command can be run locally after `pnpm install --frozen-lockfile`.

Production's historical `VITE_API_BASE_URL` setting is now `/api`; the new
client always uses same-origin routes and does not read that variable.

Set `VITE_TIANDITU_API_KEY` to the Tianditu **browser-side** key in both
production and preview build variables. Local development uses the ignored
`frontend/.env.local` (see `.env.example`). Vite embeds this public browser key
in the client bundle; never use a server-side credential here or commit an
actual key. A changed build variable requires a new build. Without this variable,
Tianditu is disabled and saved Tianditu selections fall back to OSM. With it,
the picker offers OSM (default) and Tianditu, persisting the chosen source.
Tianditu uses HTTPS `vec_w` plus `cva_w` WMTS tiles directly from its provider;
no map proxy or backend change is needed. Other legacy map-key variables are
unused. Preview read requests use the same backend; preview domains are not
added to the production write-origin allowlist.

On 2026-09-17, the production Tianditu variable was verified against the supplied
browser key and the same variable was added to Preview. Real browser checks
confirmed both Tianditu layers load on mobile and desktop, preserve the pins
and camera when switching to/from OSM, and restore the selected source after
a reload. The 292 frontend tests, three proxy tests and strict production build
passed. No actual key is stored in this repository.

The former Direct Upload project `lycoris-map-web` and its deployment history
are retained for recovery, without the production custom-domain binding.
Routine releases must use Git. If emergency manual recovery is needed, upload
only the contents of a tested `dist/` with the three configuration files above,
then explicitly rebind the domain; never use an older backend data snapshot
as a frontend rollback.

Cloudflare documents that a [Direct Upload project cannot be converted to Git
integration](https://developers.cloudflare.com/pages/get-started/direct-upload/),
so the already-connected `lycoris-main` project is used instead. See the
[build image version settings](https://developers.cloudflare.com/pages/configuration/build-image/).

Pages serves the SPA, including `/admin/*` deep links. `/api`, `/uploads`
and `/health` routes invoke the Worker, forwarding to
`https://api.lycoris-map.com` with original paths and queries. It preserves
browser Origin and authentication, streams bodies, does not follow upstream
redirects, and marks browser-facing responses private and uncacheable. The fixed
backend origin is server-side and is not embedded in the browser bundle.

## OSM edge tiles

Web maps use `/tiles/osm/{z}/{x}/{y}.png` on the current site origin. The Pages
Worker fetches the fixed `tile.openstreetmap.org` HTTPS upstream directly,
without going through the Rust backend or Tencent server. Only canonical tile
coordinates at zooms 0–19 and GET/HEAD are accepted. Arbitrary upstream URLs,
query strings, write methods and invalid coordinates are rejected.

The upstream receives a stable `LycorisMaps` User-Agent and the real browser
Referer, but no app cookies or authorization. Cloudflare's fetch cache follows
OSM freshness headers and validators; browser reload directives cannot bypass
the shared cache. Successful responses retain caching/conditional headers.
Errors and blocked images return uncacheable failures. Diagnostic response
headers `X-Lycoris-Tile-Source: osm-worker` and `X-Lycoris-Tile-Cache` identify
the route and edge cache status. The visible OSM attribution remains on the map.
No bulk loading or offline download is introduced.

The official site was verified without a configured proxy on 2026-09-20 after
PR #30 merged: HTTP 200, 256×256 PNG, 37,809 bytes, edge HIT. Local Vite
development forwards this path to the official site. Default providers and
recovery follow the language policy below.

## Tencent Maps

Set `VITE_TENCENT_MAP_KEY` to the JavaScript API GL **browser key** in both
Production and Preview build variables. Local development uses ignored
`.env.local`. This value is public in the browser bundle; actual keys must not
be committed. An absent key disables the Tencent choice and invalid saved
selections follow the available language defaults. Each variable change needs a new build.

Selecting Tencent loads its official `map.qq.com/api/gljs` SDK asynchronously
with the required callback parameter. The SDK renders the base map while
Leaflet retains the existing controls, markers and picking behavior. A CRS
adapter converts WGS84 at the map boundary to GCJ-02 and back; backend queries,
stored markers, location and contributed coordinates remain WGS84. The same
mainland coverage data and conversion approximation as the native apps are
used, including unchanged overseas/Hong Kong/Taipei coordinates. See
`src/features/map/tencent/LICENSE.txt`. This is not a surveying transformation.

The SDK and projection dataset load in parallel on selection. After a visible
OSM/Tianditu basemap has loaded, they can also warm silently during idle time.
Warmup waits for document load, three seconds without resource completions or
interaction, and `requestIdleCallback` where available. It skips hidden/offline
pages, Save-Data and reported 2G/3G connections. SDK warmup uses low fetch priority;
selection reuses the same promise and raises its priority. No map instance or
provider tiles are prefetched. Network quiet is best-effort: browsers do not
expose a universal pending-request/network-idle signal.

Tencent supports zooms 3–19 in this integration. Pan and pinch remain continuous;
discrete CSS zoom animation is disabled only while this WebGL provider is active
to keep markers aligned. Leaving the layer destroys its GPU context and restores
the OSM projection. SDK load failures, visible-page tile deadlines and GPU context
loss enter the recovery chain below. Cached Tencent views may complete through
its idle event without a new tilesloaded event. The picker uses an actual image
from Tencent Static Map API v2, with linked provider credit.

References: [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/),
[Tencent JavaScript API GL](https://lbs.qq.com/webApi/javascriptGL/glGuide/glBasic).

## Language defaults and recovery

Without a saved manual map choice, Chinese uses Tencent → Tianditu → OSM;
English uses OSM → Tencent → Tianditu. Missing browser keys are skipped. Explicit
map choices remain saved; automatic defaults and temporary fallback are never
persisted by radius/category edits. Defaults follow the app language, including
browser detection, saved language and the URL override.

Each recovery round tries every available provider at most once. A manual map
selection or Retry starts a new round. Raster providers are monitored through
real Leaflet requests: isolated edge-tile errors are tolerated, largely failed
batches or a 20-second zero-success load trigger recovery. Deadlines pause in
hidden/offline pages; reconnection retries the active renderer. No arbitrary
health-check tiles or polling are added. Exhaustion shows a dismissible retry
message, while the current camera and point data stay intact.

The source picker displays three compact previews in one row. The attribution
control uses the Leaflet text link without its flag graphic; all provider
attributions remain visible.

## Private R2 media and thumbnails

The Rust image route supports `?variant=thumb` (fits within 640 × 640) and
`?variant=detail` (1280 × 1280), keeping aspect ratio, orientation and transparency
without upscaling. Omitting the variant preserves the original. Processing is
bounded by the existing image semaphore and memory/dimension limits. Renditions
are stored under the private upload root's `.renditions-v1`; never expose that
directory through Caddy. No database migration or URL replacement is needed.

Set a Pages **R2 binding** named `MEDIA_BUCKET` to a private Standard bucket:
`lycoris-media-prod` for Production and a separate `lycoris-media-preview` for
Preview. Do not enable an R2 public URL, custom public domain or CORS access.
Never bind the production bucket to arbitrary branch builds. No S3 token or
new credential is required on the Rust server or in frontend build variables.
Cloudflare requires an R2 subscription before buckets can be created; the
account owner must approve any subscription/payment terms.

For each image GET/HEAD, the Pages Worker first makes an **uncached HEAD** to
the existing Rust route with the viewer's Cookie/Origin. Rust rechecks current
database visibility, validates the source and returns a SHA-256 ETag and object
key. Only then may the Worker read the edge cache or private R2. An authorization
failure or origin outage does not fall back to cached bytes. Changing a place
to private, deactivating it or ending an authorized session takes effect on
subsequent image requests without waiting for a cache purge. Previously downloaded
bytes cannot be recalled from a viewer's device.

On an R2 miss, the Worker requests the image from Rust with `If-Match`, streams
it to the viewer, and copies it to R2 with SHA-256 validation. It separately
caches the immutable content at the serving edge for 24 hours. Browser responses
remain `private, no-store`, and internal cache responses contain no session
cookies. Original and derived files remain on the server for backup/fallback;
R2 is the distribution copy, not the sole source of truth in this release.
Uploads and resumable upload sessions retain their existing transaction/recovery
behavior. Neither disabling a marker nor cache expiry physically deletes an R2
object. Files over 16 MiB use the existing streamed origin path to bound Worker
clone buffering; new thumbnails are much smaller. If R2 is unavailable, an
authorized origin image remains readable. Still-image Range requests use the
complete representation with HTTP 200, never a partially cached object.

Deployment order: ship the Rust release, create/bind the two private buckets,
then rebuild the Git preview. Without the binding, the Worker safely retains
the old proxy path. Check the preview using synthetic data and public reads;
the owner then merges the frontend PR to publish through the existing main
workflow. Verify `X-Lycoris-Media-Source: origin`, then `edge`/`r2`, and confirm
R2 object checksums/counts in the console. A read response alone does not prove
its asynchronous R2 copy succeeded.

Public originals/renditions can be warmed incrementally after binding:

```sh
python3 deploy/cloudflare/warm-media.py \
  --site https://lycoris-map.com \
  --report /private/path/lycoris-media-warm.json
```

The script reads the current public marker list, checks SHA-256 on every
download and checkpoints progress. It sends no account cookies and never grants
public access to pending, private or disabled media; those images are copied
only on an authorized read. A record becoming private during warming produces
a reported 404. Keep reports outside Git. This is incremental distribution
warming, not a complete backup of every uploaded file. Retain existing verified
database/media backups separately.

References: [R2 bindings/API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/).

### R2 and HTTPS rollout — 2026-09-18

- The owner activated R2. Created private Standard buckets `lycoris-media-prod`
  and `lycoris-media-preview` with an Asia-Pacific location hint; both keep public
  access disabled. Pages Production and Preview bind `MEDIA_BUCKET` to their
  respective bucket. Changes apply to the next deployment in each environment.
- Backend image `lycoris-backend:9b5ac26` is deployed through SSH. Readiness,
  PostgreSQL and Redis passed; all six business-table fingerprints and the
  application credentials were unchanged. The verified rollback backup is
  `/opt/lycoris/backups/r2-media-20260918T030819Z`. No new schema migration was needed.
- Git preview `https://ddf3207e.lycoris-main.pages.dev` passed deployment checks.
  A public sample returned `origin`, then `edge`; a separate request from the
  server through Cloudflare ICN returned `r2`, with identical SHA-256 and length.
  Two more public image URLs were warmed in all three variants with no errors.
  Seven content-addressed objects were confirmed in the private preview bucket.
- The 3,797,996-byte sample produces a 39,334-byte thumbnail and 133,098-byte
  detail image. Rust validation passed 110 selected tests and Clippy; frontend
  validation passed 304 tests, 10 Worker tests and the strict production build.
- `lycoris-map.com` uses Full (strict), an active managed wildcard/apex certificate,
  TLS 1.3, and minimum TLS 1.2. Enabled Always Use HTTPS. Public site/API requests
  and direct-origin certificate validation passed; HTTP requests redirect to
  HTTPS while preserving paths and queries. R2 is accessed by the Worker binding,
  so no public bucket domain or separate image certificate is required.
- Production frontend remains on Git main until the owner merges this branch.
  Its next deployment activates the production R2 binding and thumbnail UI.
  Original files remain on the server, with R2 populated on authorized reads.

## Git deployment and domain cutover — 2026-09-17

- `frontend-old/` was removed from Git tracking (127 files) and ignored; local
  copies were retained. The active source remains `frontend/`. Repository
  instructions now describe the production stack rather than the S1 shell.
- Rebuilding Git main `0efa846` with the new configuration produced successful
  deployment `7c035fff-7d56-4db3-b59f-af91a8897f38`. Its page and health proxy
  returned HTTP 200.
- The owner then merged PR #18. Git main `1393525` automatically triggered
  successful production deployment `aa2b8d14-895f-4ef1-aa02-bb3b146d2624`.
  No manual ZIP upload was used for either Git deployment.
- `lycoris-map.com` was moved from `lycoris-map-web` to `lycoris-main`; the
  apex CNAME targets `lycoris-main.pages.dev`. The dashboard confirmed Active
  with SSL enabled. The new backend origin and certificate settings are
  unchanged.
- Cloudflare rule `9baf5744c7814515b64eb696e3122372`, named
  `Lycoris website moved to lycoris-map.com`, is Active on `lycoris.online`.
  It matches `http.host in {"lycoris.online" "www.lycoris.online"}` and returns
  HTTP 302 to `concat("https://lycoris-map.com", http.request.uri.path)` with
  query preservation enabled. The old Pages domain bindings remain so their
  existing DNS and TLS continue supporting the edge redirect.
- External requests from the old server verified HTTPS root, HTTP
  `/maps?markerId=244&lang=zh`, and HTTPS www `/search?q=test&lang=en` return
  the matching new-domain Location. Local DNS still returns unrelated IPs for
  the blocked old domain; the edge redirect cannot fix upstream DNS blocking.
- All 286 frontend tests, three proxy tests and the strict production build
  passed locally using the configured build command. The Git-built HTML,
  JavaScript, CSS and map previews (13 files) byte-match the local build.
- The old server's application, Nginx, PostgreSQL and Redis were stopped and
  auto-start disabled, with database, media and verified backups retained.
  The new site's health still reports PostgreSQL and Redis healthy. See the
  [server retirement record](../../../backend/deploy/production/README.md).

For frontend rollback, prefer the previous successful Git deployment in
`lycoris-main` (initial verified release `7c035fff`). The preserved manual
project's last deployment is `e0c442e4-8654-4728-86f8-70c7786c1bec`. A rollback
must preserve the current `/api`, `/uploads` and `/health` proxy configuration.
Turning off the redirect rule restores old-host delivery but must not restart
the obsolete Java writer or reverse the migrated database.

The sections below are historical release records and may refer to the former
manual-upload project or earlier domain configuration.

## Deployment record — 2026-09-16

- Application source: `88fbb4af3d3e6ea3925ab6fee9bdd2d241daa06d`.
- Deployment proxy: `9f5f6f9`.
- All 21 artifact files uploaded and Cloudflare reported deployment success.
- Cloudflare created the apex CNAME to `lycoris-map-web.pages.dev`.
- Chrome rendered the application and OSM tiles at the HTTPS custom domain.
- `/` and `/admin/review` returned HTTP 200 HTML.
- `pnpm build` passed, including strict TypeScript checks. The existing main
  bundle size warning remains. All three proxy tests passed.

## Backend connected — 2026-09-16

The Rust backend now runs in Docker on `43.155.130.105` (`lhins-oszy3oc8`, Seoul).
The designated old production database and all 264 uploaded files were backed
up, migrated and verified. Caddy serves `api.lycoris-map.com` with a valid
certificate behind Cloudflare Full (strict). The existing Pages proxy required
no frontend rebuild. `/health/ready` now returns HTTP 200 with PostgreSQL and
Redis both healthy, and public point/search/nearby/detail/image requests pass.
Chrome displayed real nearby points and their photographs. Secure host-only
session cookies and the new domain's write origin are configured.

See the [backend deployment record](../../../backend/deploy/production/README.md)
for backup locations, data counts, migration versions and rollback constraints.
The old writer is stopped; its database and media remain intact. Real-account
login and authenticated writes still need owner acceptance on the live site.

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
the frontend; the later backend cutover is documented above.

## Nearby spacing and photo loading — 2026-09-16

Commit `967c9a4` lets Nearby descriptions shrink to their actual text height,
retaining the three-line clamp and 10px gap above the action buttons. Nearby
and detail photos share a rounded loading placeholder with a subtle shimmer
and a 220ms reveal. Existing image dimensions and lazy loading are preserved;
failed images are removed, cached images appear immediately, and a changed URL
starts a fresh load state. Reduced-motion preferences disable the animation.

All 245 unit tests and the strict TypeScript production build passed. Chrome
verified desktop and mobile layouts using live public reads through a local
read-only preview, with an artificial eight-second image delay. Cloudflare
reported success after uploading all 21 artifact files. The custom-domain HTML
now references `index-DOmxOlNZ.js` and `index-Cwmq9PS3.css`.

## Mobile sheet motion and content height — 2026-09-16

Commit `b25c9d3` keeps the sheet's layout stable and moves it with a composited
transform. Touch movement updates a CSS variable once per animation frame;
React and the map rerender only when the resting snap changes. Main-menu
sections are mounted ahead of dragging, while inactive sections remain inert
and hidden at rest. Nested result scrollers keep native scrolling; downward
sheet gestures settle before closing and cancel on navigation or interruption.

Live place details use measured content height, capped at the available screen
height. Short text and missing/failed photos no longer reserve a 433px panel.
Photos retain their aspect ratio, long content scrolls, and action buttons have
22px of internal bottom padding plus the device safe area. The panel stays
flush with the viewport bottom.

All 249 frontend tests, strict TypeScript, production build and formatting
checks passed. Chrome touch emulation verified main-menu snapping, detail
scrolling/dismissal, and nested Nearby scrolling in both directions. At a 667px
viewport height, the no-image fixture measured 187px, a live photo detail 434px,
and a 774px long-content fixture was capped to 621px with internal scrolling.
The action row ended at 645px in all three cases. A failed image also shrank the
panel after its request failed. Physical-device Safari was not tested.

Cloudflare reported deployment success after all 21 artifact files uploaded.
The custom-domain HTML references `index-DlFBwTjC.js` and
`index-Y45GkDWD.css`; `/health/ready` returns HTTP 200 with PostgreSQL and Redis
healthy. Chrome verified the deployed menu can be dragged open and closed.

## Nearby drag dismissal P1 — 2026-09-16

Commit `ac226c1` makes a completed secondary-sheet dismissal invoke the same
close action as X in the release event. It removes the extra 280ms close timer
and the intermediate hidden panel; the primary menu settles from the released
finger position. No deferred close can run after another panel has opened.

All 253 tests and the strict TypeScript production build passed. New real-page
regressions compare Nearby drag dismissal with X from the radar, half/full menu
category cards, and direct links, including route, menu height, focus and map
preservation. Gesture coverage also checks cancellation and duplicate release.
Chrome iPhone SE touch emulation verified local radar → Nearby → complete pull
down → original collapsed primary menu. The originally reported error was not
reproduced in Chrome before the change; physical-device Safari remains untested.

Cloudflare reported success after uploading all 21 artifact files. The custom
domain serves `index-NlT5wN_y.js`; `/health/ready` reports PostgreSQL and Redis
healthy. Chrome verified the deployed radar → Nearby → full downward drag flow
returns to the original collapsed primary menu without an application error.

## Map polish, contribution login and settings menus — 2026-09-17

Application source `05773a587c05404cadcbbaf3511219e0b08181aa` includes the
previously pending map/location and sheet polish, contribution login gate,
anchored title-free settings popovers, and default half-open phone menu.

All 282 frontend tests, three deployment proxy tests, strict TypeScript and
the production build passed. Only the 21 production artifact files were
uploaded through Chrome Computer Use; the local synthetic preview, sources,
credentials and test data are not in the artifact. Cloudflare reported success
for production deployment `3e00e4c3-3c57-4ef9-8350-339f05eef04e`.
The previous deployment is `eed3063f-9574-422a-9bf2-78335bd4d96d`.

The custom domain serves `index-MlC4fVRD.js` and `index-DuBdz8aK.css`.
The home HTML and both resources were byte-compared with the release artifact.
`/admin/review` returns the updated SPA; `/health/ready` returns HTTP 200 with
PostgreSQL and Redis healthy. Chrome verified the title-free desktop settings
popover, Escape preserving Settings, guest Contribute opening login and cancel
returning home. iPhone SE emulation at 375×667 verified first-load half snap,
dragging to full and the title-free anchored phone settings popover. DevTools
was closed and the production homepage was left without test snap parameters.
Physical-device compass and touch behavior remain untested.

Release ZIP: `settings-mobile-05773a5/lycoris-settings-mobile-05773a5.zip` in the
surrounding deployment workspace. SHA-256:
`96dbbc69cf2a98f0d06fdff6528d93c0b7504645bbd562bf0a692f8a97729275`.
The backend, database and old domain were not modified in this release.

## Menu, profile, map picker and search-range polish — 2026-09-17

Application source `37f4b442225a41d5b7190c73a2c3fcc6ab4dcd56` includes the
content-sized full phone menu, full-width phone login action, profile identity
and grouped account options, map-source preview picker and search-range styling.
OSM remains the default and active provider; Tianditu and Google Maps are
disabled previews pending service keys, as agreed. The range popup now uses
24px outer corners, 22px controls, lavender selection and the app's blush action
button. Preset and custom-range behavior is unchanged.

All 286 frontend tests, three proxy tests, strict TypeScript, the production
build and changed-source formatting checks passed. Chrome Computer Use checked
custom range saving and preset dismissal locally, plus the deployed desktop
and 320×667 range popup and desktop map-source previews. Escape dismissed the
popup while preserving Settings; closing Settings returned to the primary map.
Physical-device touch, software keyboards and Safari were not tested.

Chrome uploaded all 24 production artifact files and Cloudflare reported
success. Production deployment: `e0c442e4-8654-4728-86f8-70c7786c1bec`.
The previous deployment shown by Cloudflare immediately before this release
was `b5ef9730-3413-4d5a-ac65-7decbb1b6d05` (rollback target); its public page
still referenced `index-MlC4fVRD.js` and `index-DuBdz8aK.css`.

The custom domain now serves `index-DCArVGfo.js` and `index-3ENa2zIT.css`.
Home HTML, both resources, all three preview images and the `/admin/review`
SPA response were byte-compared successfully with the artifact. All returned
HTTP 200; `/health/ready` returned PostgreSQL and Redis healthy. Cloudflare's
optional analytics beacon had a connection error in this browser session;
the application and API health checks succeeded. Guest `/api/me` returned the
expected HTTP 401.

Release ZIP: `ui-polish-37f4b44/lycoris-ui-polish-37f4b44.zip` in the surrounding
deployment workspace. SHA-256:
`67d31e82f4ee5b24a39dc5af2e56a59e918ea1305f46d09e4c1464716f6fe8b9`.
Release metadata and verification results are beside the ZIP. Only built
assets and the existing Pages worker/routes/headers were uploaded; fixtures,
credentials and source files were excluded. No backend, database or old-domain
changes were made.
