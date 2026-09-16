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
