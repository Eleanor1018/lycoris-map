# Settings popovers — 2026-09-16

Branch: `deploy/lycoris-map-com`.
Status: implemented and verified in a local preview; not deployed.

## Behavior

Settings rows open a compact, anchored Radix popover instead of navigating to
another panel. Desktop placement starts beside the row; mobile placement uses
the space above or below it, with an 11px viewport collision margin. Existing
settings, values, translations and visual tokens remain in use.

Choosing an option saves it and closes the popover. Custom range closes after a
valid save. Outside click, the close button and Escape dismiss the popover;
Escape during IME composition leaves it open. Dismissal returns keyboard focus
to the originating row without navigating away from Settings. Scrolling the
underlying content or starting a touch gesture outside the options dismisses
the popover, preventing a detached menu during mobile sheet movement. Scrolling
inside the popover remains available.

Direct legacy setting URLs and the separate desktop Languages/map toolbar
entry points retain their existing behavior.

## Verification

- All 281 unit/integration tests passed, including preference persistence,
  keyboard choice/focus, custom range validation, outside dismissal, touch and
  scroll dismissal, mobile panel retention, and desktop Escape/IME behavior.
- TypeScript strict checks, production build, formatting and diff checks passed.
  The existing main bundle size warning remains.
- Computer Use in the Codex in-app browser exercised the production bundle on
  the local synthetic preview at port 4176: desktop 1280×720, mobile 375×812 and
  375×667. Range and category popovers stay next to their rows and inside the
  viewport; mobile menus flip above lower rows. Chinese and English, selection,
  custom range save, X, Escape, focus restoration and retained Settings content
  were verified in the browser. The temporary viewport override was reset.
- The local preview uses fixed synthetic coordinates and point data. No account,
  real location, or production data was modified. Physical iOS/Android touch and
  software-keyboard behavior have not been tested.

The in-app browser is usable for local checks. This does not establish that the
previously unavailable native Chrome input or Cloudflare upload path works.
