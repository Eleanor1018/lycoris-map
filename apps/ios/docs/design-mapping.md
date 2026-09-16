# iOS design mapping and staged boundaries

Reference: [Lycoris mobile-ios](https://www.figma.com/design/nmsiDbbgm0LG0CSwXUSLPW/Lycoris-v2-design?node-id=10-969), checked with Figma MCP and Computer Use on 2026-09-16.

| Surface | Source | Phase |
| --- | --- | --- |
| Collapsed map panel | 10:970 | I2 visuals complete; native material and safe areas |
| Nearby panel | 45:169 plus page siblings 45:246, 45:223, 45:234 | I3 shared result flow complete |
| Expanded panel | 45:248 plus heading arrows 45:416, 45:418 | I2 visuals complete / I4 authenticated bookmarks / I6 settings |
| Place details | 65:1989 plus sibling Navigate button 65:2170 | I3 public data and actions complete |

The four frames are 402 × 874. The scene uses real device safe areas instead of copying the drawn status bar. Reference panel width is 352 when collapsed and 382 when open: 25/10 point horizontal margins. Panel corner radius is 26, search height 38, avatar diameter 38, avatar gap 8. Map tool groups are 48 × 96 with a 23 point gap. Text and content heights can grow with Dynamic Type.

Apple Maps is the approved iOS map provider. The settings reference's OSM label becomes Apple Maps. Existing Web-specific 11px margins and 44px avatar do not override this iOS design. Anonymous users do not see the Bookmarks heading/group or an empty reserved gap.

## Design gaps to resolve before their implementation

| Flow | Available basis | Required decision / stage |
| --- | --- | --- |
| Search / Nearby results | Existing point rows and approved Web behavior | I3 reuses the rounded iOS place rows, title3/subheadline styles and minimal loading/empty/retry text; category cards and radar share one destination |
| Login / register / profile | Existing account forms, Figma auth reference 126:382 | Map fields and native presentation before I4; no iOS-complete auth frame yet |
| Contribution / editing | Existing contribution form and backend semantics | Native form/picking sequence before I5; pen is the entry; no public/private control |
| Settings subpages | iOS settings rows, existing preferences | Native selection presentation before I6 |
| Microphone | Symbol exists, no defined behavior | Decide native speech behavior or an honest unavailable state before completing search |
| Apple / Google login, verification, recovery, account deletion | Backend does not implement these flows | Separate scoped backend work if included; logout is not account deletion |
| iPad | No dedicated native design supplied | Separate adaptation decision |

Explicit Debug fixtures remain isolated from live networking and real actions. Default and Release launches are anonymous and do not inject sample bookmarks. I3 connects category results, search, map pins, Core Location, sharing and navigation. Account/bookmark writes await I4, contribution/editing await I5, settings and voice decisions await I6. Those controls continue to show a native unavailable alert.

I3 rechecked `65:1989` and the previously approved Nearby behavior reference `140:147` with Figma MCP. No complete iOS result screen exists in the supplied page, so the approved existing point-row style is reused within the same panel. A compact results heading/close control and status text support that flow. Actual missing photos/descriptions are omitted; the decorative Figma image never substitutes for absent API content. Real distance metadata explicitly names the reference point.

I2 preserves the original photo bytes (300×168), 353:198 display ratio and 16pt image corners. Share/Navigate use native capsule button materials; the photo and panel height adapt to screen width. At accessibility text sizes the actions stack vertically and content remains scrollable. The iOS page's fixed 44pt status-bar sketch is replaced by the device safe area, so the full panel's content may need a short scroll on the baseline phone.
