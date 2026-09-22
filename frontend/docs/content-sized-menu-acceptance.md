# Content-sized mobile menu and settings polish — 2026-09-17

## Default nearby menu update

Branch: `chore/production-cutover`; pending merge to `main` for production.

The initial phone menu stays at the middle stop with Search and all three
nearby categories visible. Its height now follows the bottom of the nearby
cards plus 22px and the device safe area, rather than the fixed 320px height.
The resting height and drag snap share this measurement. Pulling down still
collapses the menu; pulling up reveals the remaining sections at their natural
height. Explicit snap URLs, search results and secondary panels retain their
existing behavior.

All 288 frontend tests, strict TypeScript and the production build passed.
Regression coverage checks initial nearby visibility, content resizing,
viewport caps, keyboard stops and dragging through the measured middle stop.
Chrome Computer Use on the local fixture preview verified the default Chinese
menu at 320×667 and 375×812, touch-emulated collapse/expansion, and keyboard
return to the middle stop. Physical-device touch and safe-area insets were not
verified on hardware.

## Earlier full-menu release

Branch: `deploy/lycoris-map-com`.
Status: deployed to lycoris-map.com on 2026-09-17 in production release
`e0c442e4-8654-4728-86f8-70c7786c1bec`; see `deploy/cloudflare/README.md`.

## Behavior

- The primary phone menu's full snap follows its measured content height,
  including the existing 22px bottom padding and device safe area. It is capped
  at the available viewport height; longer content remains scrollable. Content
  and viewport changes update the measurement. The default half snap remains
  320px. Search results and secondary panels keep their existing sizing.
- The drag limit uses the same measured height, preventing an oversized drag
  position from snapping back to a shorter menu. Map controls that cannot fit
  above the sheet are hidden along with their existing inert state.
- Settings popovers have no visible title or close button. They use a light
  translucent surface, thin border, soft shadow and subtle selection fill.
  The originating setting row uses a neutral pressed/open background. Choosing
  an option, clicking outside, clicking the originating row again, and Escape
  still dismiss the popover. Accessible names and keyboard focus are retained.
- The phone login form's submit button fills its container with 11px margins
  at both screen edges.

## Verification

- All 284 tests in 38 files passed. New regressions cover content resizing,
  viewport caps, the unchanged half snap, and dragging to the measured limit.
- Strict TypeScript checks, production build, formatting and diff checks passed.
- Computer Use verified the built app with synthetic data on port 4176:
    - At 390×844, the fully expanded primary menu measured 619px, with 22px
      between the final content row and the screen bottom.
    - At 375×600, expansion was capped at 554px. Scrolling reached the final
      row with the same 22px bottom spacing.
    - A drag from the half snap settled at the natural full height. Collapse
      and the handle's snap cycle also remained usable.
    - Settings popovers were checked on phone and 1280×720 desktop, including
      active-row styling, missing title/X, and Escape dismissal.
    - The login submit button measured 368px at a 390px viewport: 11px per side.
- The temporary viewport override was reset. No production data or accounts
  were changed. Physical-device touch and software keyboards were not tested.

This supersedes the local appearance described in
[settings-popover-acceptance.md](settings-popover-acceptance.md). That document
records the earlier production version.
