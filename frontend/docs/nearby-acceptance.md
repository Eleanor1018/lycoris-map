# Nearby list acceptance

Date: 2026-09-16. Branch: `refactor/web-frontend-v2`.

Reference: [Figma 140:147](https://www.figma.com/design/nmsiDbbgm0LG0CSwXUSLPW/Lycoris-v2-design?node-id=140-147).
Read through Figma MCP and compared with the running application using Computer Use.

## Behavior

- Desktop Search category cards open the dedicated Nearby second panel.
- Mobile Search category cards and the map's radar button open the same Nearby list in the full sheet.
- Category cards select accessible toilets, nursing rooms or medical institutions respectively. Radar uses the current default setting, accessible toilets within 1 km.
- Categories survive URL reloads through `nearbyCategory`. A fresh page queries around the current map center; the page does not put the user's coordinates in the URL. Within a browse session, the nearby center stays fixed while panning. An explicit location fix can update it.
- Each result uses real API title, distance from the search center, hours, optional image and description. Share and Navigate reuse the existing place actions. Missing or failed photos are omitted.
- Mobile detail → Nearby restores category, scroll position and title focus; closing Nearby returns to its entrance. Desktop Close dismisses the second panel and focuses Search.
- Lists over 100 items render a window of cards, measure variable heights and retain measurements with the scroll position. Height changes preserve the visible row or keyboard target.

## Visual checks

Measured on the existing development fixture at 1440 × 1024. These panel coordinates match the supplied desktop node:

| Element          | Position (x, y) | Size                             |
| ---------------- | --------------- | -------------------------------- |
| Second panel     | 240, 0          | 320 × 1024                       |
| Nearby heading   | 256, 26         | 32px type, 20px line height      |
| Category heading | 256, 80         | 288 × 48                         |
| Place title      | 256, 128        | 258 × 48 for the reference title |
| Photo            | 256, 196        | 280 × 157, radius 16             |
| Description      | 256, 353        | 283 × 60                         |
| Share            | 250, 423        | 144 × 44                         |
| Navigate         | 401, 423        | 144 × 44                         |

At 375 × 812, content, image and actions span x=11 through x=364. Mobile uses the existing sheet and title styling. Production records supply their own text and images; the existing Figma fixture is development-only.

Local screenshots:

- `/Users/nora/Documents/Codex/2026-09-14/wen/outputs/nearby/desktop-figma-fixture.png`
- `/Users/nora/Documents/Codex/2026-09-14/wen/outputs/nearby/mobile-figma-fixture.png`
- `/Users/nora/Documents/Codex/2026-09-14/wen/outputs/nearby/desktop-live-medical.png`

## Validation

`pnpm test:unit`: 206 tests across 29 files passed. Strict TypeScript checking and production build passed. The build retains the existing main-chunk size warning.

Unit coverage includes all six category entrances, radar, direct category URLs and empty results, desktop dismissal, mobile history/focus/scroll restoration, individual sharing, failed images, request cancellation, and 500-item list restoration with both estimated and nonzero measured row heights. Computer Use also exercised the real local Rust reads, radar, nursing-room entry, detail return, desktop close and medical-category empty state. No browser warning/error was reported during that final live flow.

This change does not alter the backend or deploy the application.
