# iOS design mapping and staged boundaries

Reference: [Lycoris mobile-ios](https://www.figma.com/design/nmsiDbbgm0LG0CSwXUSLPW/Lycoris-v2-design?node-id=10-969), checked with Figma MCP and Computer Use on 2026-09-16.

| Surface | Source | Phase |
| --- | --- | --- |
| Collapsed map panel | 10:970 | I2 visuals complete; native material and safe areas |
| Nearby panel | 45:169 plus page siblings 45:246, 45:223, 45:234 | I2 visuals complete / I3 results |
| Expanded panel | 45:248 plus heading arrows 45:416, 45:418 | I2 visuals complete / I4 authenticated bookmarks / I6 settings |
| Place details | 65:1989 plus sibling Navigate button 65:2170 | I2 visuals complete / I3 data |

The four frames are 402 × 874. The scene uses real device safe areas instead of copying the drawn status bar. Reference panel width is 352 when collapsed and 382 when open: 25/10 point horizontal margins. Panel corner radius is 26, search height 38, avatar diameter 38, avatar gap 8. Map tool groups are 48 × 96 with a 23 point gap. Text and content heights can grow with Dynamic Type.

Apple Maps is the approved iOS map provider. The settings reference's OSM label becomes Apple Maps. Existing Web-specific 11px margins and 44px avatar do not override this iOS design. Anonymous users do not see the Bookmarks heading/group or an empty reserved gap.

## Design gaps to resolve before their implementation

| Flow | Available basis | Required decision / stage |
| --- | --- | --- |
| Search / Nearby results | Existing point rows and approved Web behavior | Native list and empty/error states in I3; category cards and radar share one destination |
| Login / register / profile | Existing account forms, Figma auth reference 126:382 | Map fields and native presentation before I4; no iOS-complete auth frame yet |
| Contribution / editing | Existing contribution form and backend semantics | Native form/picking sequence before I5; pen is the entry; no public/private control |
| Settings subpages | iOS settings rows, existing preferences | Native selection presentation before I6 |
| Microphone | Symbol exists, no defined behavior | Decide native speech behavior or an honest unavailable state before completing search |
| Apple / Google login, verification, recovery, account deletion | Backend does not implement these flows | Separate scoped backend work if included; logout is not account deletion |
| iPad | No dedicated native design supplied | Separate adaptation decision |

I2 uses explicit Debug fixtures for bookmarks and details. Default and Release launches remain anonymous with no sample data. A preview bookmark row opens its detail panel; the grabber expands or dismisses details and radar returns to Nearby. Category results, settings destinations, account, location, contribution, sharing, navigation and saved bookmarks still await their planned stages. Their current handlers show a native unavailable alert, never a false success. No new navigation bar, preview menu or technical stage label is added to the app.

I2 preserves the original photo bytes (300×168), 353:198 display ratio and 16pt image corners. Share/Navigate use native capsule button materials; the photo and panel height adapt to screen width. At accessibility text sizes the actions stack vertically and content remains scrollable. The iOS page's fixed 44pt status-bar sketch is replaced by the device safe area, so the full panel's content may need a short scroll on the baseline phone.
