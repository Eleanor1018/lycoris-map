# iOS design mapping and staged boundaries

Reference: [Lycoris mobile-ios](https://www.figma.com/design/nmsiDbbgm0LG0CSwXUSLPW/Lycoris-v2-design?node-id=10-969), checked with Figma MCP and Computer Use on 2026-09-16.

| Surface | Source | Phase |
| --- | --- | --- |
| Collapsed map panel | 10:970 | I1 container / I2 visual completion |
| Nearby panel | 45:169 plus page siblings 45:246, 45:223, 45:234 | I1 container / I2 cards / I3 results |
| Expanded panel | 45:248 | I1 container / I2 visuals / I4 authenticated bookmarks / I6 settings |
| Place details | 65:1989 plus sibling Navigate button 65:2170 | I2 visuals / I3 data |

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

I1 only demonstrates panel presentation and keyboard handling. Category/settings rows, avatar, map source, location and pen artwork are static preview content, not functioning account/location/contribution controls. The radar opens the nearby panel prototype. Do not present these stubs as completed product flows.
