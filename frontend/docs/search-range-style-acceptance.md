# Search range popover polish — 2026-09-17

The search-range popover uses the existing Lycoris tokens: 24px outer corners,
22px option/input/button corners, lavender selection, blush primary action and
brand-colored text and keyboard focus. Form controls are at least 44px tall;
labels, input text and options share an 11px inset. The input focus outline
touches its border, matching the account form. Other settings menus keep their
existing styling.

Behavior is unchanged: presets save and dismiss immediately; a valid custom
range saves on submission. Existing validation, outside dismissal, Escape and
focus restoration remain covered by the settings tests.

Validation: all 286 frontend tests (38 files), three Cloudflare proxy tests,
strict TypeScript, production build and changed-file Prettier checks passed.
Chrome Computer Use verified desktop custom 1500m save, the parent row updating
to 1.5km, and the 320×667 phone layout with a fully visible input and Save
button. Selecting 1km in the phone popover updated the row and dismissed the
popover. Screenshots are stored outside the repository in `work/range-style-qa`.
Physical-device keyboard and Safari were not tested.

Production release status is recorded in `deploy/cloudflare/README.md`.
