# Map and mobile interaction polish — 2026-09-16

Branch: `deploy/lycoris-map-com`. Application commits: `6d11a97`, `ef5b976`.
Status: deployed on 2026-09-17 with application source `05773a5`.
The dated checks below record the earlier local work and its limitations.
See the [production deployment record](../deploy/cloudflare/README.md) for the
completed upload and current browser checks; physical-device QA remains open.

## Changes

- Supercluster starts at ten points. Groups of one through nine remain separate
  at every zoom; a separate small group stays independent of a ten-point cluster.
- The map requests geolocation on entry, once per mount even in StrictMode.
  It does not time out while the initial browser permission question is open.
  Denial, manual retry, late results and unmount remain recoverable. A late
  initial fix does not replace an opened place or an existing focus request.
- North-referenced orientation rotates the original Figma location fan. Desktop
  and mobile use their distinct original exports. Relative/unreliable/stale
  readings leave a plain dot. Screen rotation and crossing north are handled;
  iOS sensor permission is requested from the existing locate button gesture.
  Coordinates and sensor readings are not persisted by these changes.
- The guest login hint is a naturally wrapping sentence. Share/navigation use
  centered text/icon groups for both languages; contribution bubble text is
  centered between its icons. Desktop detail and Nearby description/action
  spacing is 22px, without a reserved three-line description height.
- Dragging writes sheet/attribution transforms directly, without a map-root
  inherited variable or an extra animation-frame delay. Pressing a settling
  sheet freezes it at the visible position. Outgoing content stays painted
  during settling. Existing nested scroll, input, cancel, reduced motion and
  secondary-dismissal behavior is retained.

## References and checks

Figma MCP design context: `nmsiDbbgm0LG0CSwXUSLPW`, desktop `18:2383`, mobile
`18:1763`. Both SVGs were downloaded and byte-compared with the earlier exports;
mobile production asset provenance is recorded in `src/assets/figma/provenance.json`.
Apple Maps was opened in Chrome iPhone SE emulation and its initial drawer was
visually inspected. Its dragging could not be exercised: Computer Use reported
`noWindowsAvailable` for coordinate input, and keyboard navigation did not take
focus. Do not describe this as a completed Apple Maps gesture comparison.

All 267 unit/integration tests passed. After the mobile-specific asset change,
all 14 affected location/heading/map tests passed again. Strict TypeScript and
production build passed; formatting and git diff checks passed. The existing
large main-chunk warning remains. Physical iOS/Android compass and touch behavior
have not been tested.

A local-only synthetic QA server is available on port 4176 in the Codex task
workspace. It injects fixed test coordinates and nine/ten synthetic places into
an unmodified production bundle; none of its overrides or fixtures are in the
release artifact. Browser checks still needed: first-load permission on the
ordinary preview, direction fan/9-versus-10 pins on the synthetic preview,
Chinese/English action alignment and 22px spacing, mobile drag interruption and
Nearby full pull-down matching X.

Prepared artifact: `map-polish-ef5b976/lycoris-map-polish-ef5b976.zip` in the
surrounding deployment workspace, 21 files including the existing Cloudflare
worker/routes/headers. Main bundle `index-BjV_7s2k.js`; CSS `index-BpF3nIJG.css`.
This artifact has not been uploaded. The current live application is `ac226c1`.

## Follow-up: contribution login gate — 2026-09-16

Application commit `0c5b0eb` requires a confirmed session for contribution
entry points and direct picker/composer URLs. Guest users see the existing
login interface; successful login resumes the requested contribution route.
Cancel closes the pending contribution using the usual panel close action,
and cannot dismiss another route after navigation. A returning user waits for
the initial session check instead of receiving an unnecessary login prompt.
The account dialog now explicitly references its existing title for accessibility.

All 275 tests, strict TypeScript/build, formatting and diff checks passed. New
regressions cover both viewport modes, successful login, cancellation/re-entry,
direct URLs, navigation during login, and initial session confirmation.
Computer Use can still read Chrome but keyboard navigation does not activate
the requested URL; browser QA and deployment remain pending.

The latest prepared artifact supersedes the earlier ZIP above:
`contribution-login-0c5b0eb/lycoris-contribution-login-0c5b0eb.zip` (21 files).
Main bundle: `index-i_oX79Ep.js`; CSS: `index-BpF3nIJG.css`.
SHA-256: `af9da322f8a67041cc46a1789ef852a34b6c523304fdf683aeac942f09b38795`.
It has not been uploaded.
