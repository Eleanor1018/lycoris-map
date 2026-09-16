# Map source picker — 2026-09-17

Branch: `deploy/lycoris-map-com`. Status: locally verified, not deployed.

The toolbar map-source button opens an anchored popover instead of navigating
to a second panel. Its layout follows the macOS Maps map-mode popover observed
with Computer Use: a compact translucent surface, centered title, horizontal
map thumbnails, blue selection outline and labels below the images. No close
button is added; selection, clicking outside, toggling the trigger or Escape
dismisses it. Changing the underlying panel or sheet snap also dismisses it.
Opening and closing the picker preserves the current route and map instance.

The options are OSM, 天地图 and Google Maps. OSM is selected by default. Per the
user's explicit scope clarification, Tianditu and Google Maps are preview-only
until their API keys are connected. They are visibly marked as not available,
disabled, and cannot change the underlying OSM map or saved preference. No key,
billing setup, provider API integration or backend change is included.

The Settings map-source entry reuses the same thumbnail options without adding
a title or close button to its existing popover. The legacy source panel also
reuses the options. The three images are real screenshots from public Shanghai
maps, cropped and resized to 160×160 WebP; see the
[asset source record](../src/assets/map-sources/README.md).

Verification:

- All 286 tests in 38 files passed. New desktop/mobile regression checks cover
  the default selection, disabled providers, selection and Escape dismissal,
  focus restoration, stored OSM choice, and retained route/map instance.
- Strict TypeScript checks, production build, formatting and diff checks passed.
- Chrome Computer Use checked desktop, iPhone SE 375×667 and Responsive 320×667
  against the built app on the local synthetic preview at port 4176. All three
  previews load. Narrow screens shrink the popover so the toolbar remains
  uncovered. Choosing OSM closes the popover; outside map clicks and Escape
  also close it. The Settings source entry shows the same three options and
  remains in Settings after dismissal.
- The Chrome device preset was restored to iPhone SE, and DevTools was closed,
  returning to the normal desktop viewport. Real devices were not tested.
- Apple Maps on the web did not load reliably in this session; the working
  native macOS Maps app supplied the visual reference. The local QA page uses
  synthetic coordinates and data. No production data or accounts were changed.

Production follow-up: deployed on 2026-09-17 in release
`e0c442e4-8654-4728-86f8-70c7786c1bec`; see `deploy/cloudflare/README.md`.
