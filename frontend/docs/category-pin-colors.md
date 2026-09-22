# Category pin colors — 2026-09-17

Individual map places now use category-specific colors with the original
`map-place.svg` geometry, 27×43 size, anchor, white edge, center and shadow.
The Figma export remains unchanged; cached Leaflet icons recolor only its body.

| Category | Color | Source |
| --- | --- | --- |
| Accessible toilet | `#6393F2` | Original Figma blue |
| Nursing room | `#FFA726` | MUI orange 400 |
| Medical institution | `#66BB6A` | MUI green 400 |
| Other / `self_definition` | `#9575CD` | MUI deep purple 300 |

Additional colors use the [MUI palette](https://mui.com/material-ui/customization/color/#color-palette).
No MUI dependency is added. Selected and detail-only places retain their category
color, including when the same marker changes category. Coordinate-only targets,
the location dot and numeric clusters retain their existing appearance.

All 289 frontend tests, strict TypeScript, production build, changed-file
formatting and diff checks passed. The Leaflet regression checks category updates
without replacing the map or marker element, selection and detail-only rendering.
Chrome Computer Use verified four synthetic categories on desktop and at a
375×812 mobile viewport, and the selected nursing-room pin's orange color.
The local fixture server is outside the repository; no live place data was changed.

Branch: `chore/production-cutover`; production updates after merge to `main`.
