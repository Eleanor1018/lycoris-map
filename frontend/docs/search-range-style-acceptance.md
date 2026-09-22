# Search range popover polish — 2026-09-17

The search-range popover uses the existing Lycoris tokens: 24px outer corners,
22px input/button corners, blush primary action and
brand-colored text and keyboard focus. Form controls are at least 44px tall;
labels and input text share an 11px inset. The input focus outline
touches its border, matching the account form. Other settings menus keep their
existing styling.

The range defaults to 1000 meters (1km). The popover contains one numeric input
with a meter label and Save button; the 1km/2.5km presets and their divider are
removed. Valid saved preferences remain unchanged. Submitting saves the range,
updates the settings row and dismisses the popover. Escape dismisses an unsaved
edit without changing the stored radius. Validation still accepts whole meters
from 1 to 50000, and the input receives focus when opened.

Validation: all 287 frontend tests (38 files), strict TypeScript, production
build and changed-file Prettier checks passed. Tests cover desktop/mobile input
focus, invalid values, Enter submission, reopening, Escape without saving and
blocked local storage.
Chrome Computer Use verified desktop 1500m save with Enter, the parent row
updating to 1.5km, and the 320×667 phone layout with a fully visible input and
Save button. Saving 1000m from the phone layout updated the row to 1km and
persisted after refresh. Browser checks used the local fixture preview.
Physical-device keyboard and Safari were not tested.

Production release status is recorded in `deploy/cloudflare/README.md`.
