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
| Login / register / profile | Auth references 126:382 and 126:513 | I4 uses the user-approved native sheet and Form/List mapping; no iOS-complete account frames exist |
| Contribution / editing | Contribution frame 74:4744 and backend semantics | I5 follows the user's latest fully native preference: map selection, native Form, DatePicker and PhotosPicker; pen is the entry; no public/private control |
| Settings subpages | iOS settings rows, existing preferences | Native selection presentation before I6 |
| Microphone | Symbol exists, no defined behavior | Decide native speech behavior or an honest unavailable state before completing search |
| Apple / Google login, verification, recovery, account deletion | Backend does not implement these flows | Separate scoped backend work if included; logout is not account deletion |
| iPad | No dedicated native design supplied | Separate adaptation decision |

Explicit Debug fixtures remain isolated from live networking and real actions. Default and Release launches revalidate their session and never inject sample bookmarks. I3 connects category results, search, map pins, Core Location, sharing and navigation. I4 account and bookmark actions and I5 contribution/editing are connected. Settings and voice decisions await I6; those remaining controls show a native unavailable alert.

I3 rechecked `65:1989` and the previously approved Nearby behavior reference `140:147` with Figma MCP. No complete iOS result screen exists in the supplied page, so the approved existing point-row style is reused within the same panel. A compact results heading/close control and status text support that flow. Actual missing photos/descriptions are omitted; the decorative Figma image never substitutes for absent API content. Real distance metadata explicitly names the reference point.

I2 preserves the original photo bytes (300×168), 353:198 display ratio and 16pt image corners. Share/Navigate use native capsule button materials; the photo and panel height adapt to screen width. At accessibility text sizes the actions stack vertically and content remains scrollable. The iOS page's fixed 44pt status-bar sketch is replaced by the device safe area, so the full panel's content may need a short scroll on the baseline phone.

## I4 account presentation (updated 2026-09-16)

The initial I4 mapping preserved the Web auth artwork in a native sheet. The user subsequently requested fully native Apple-style UI and UX for login. That newer request supersedes the Figma-specific auth colors, fields, button shapes and typography described in the original I4 acceptance record.

Login and registration now use SwiftUI NavigationStack, Form, Section, TextField, SecureField, Button and system toolbar controls. System fonts, grouped backgrounds, separators, spacing, sheet corners and light/dark appearances replace the custom purple surface and exported auth icons. Registration pushes onto the native navigation stack; the system Back action returns to login. The close action stays in the navigation bar, and keyboard Done dismisses input.

Email and username use Next to move focus; password uses Go to submit. Password AutoFill metadata and secure entry remain intact. Invalid registration cannot submit from the keyboard. Controls prevent repeated submissions while a request is active; leaving a screen clears its password. Errors and progress remain within the native form and scale with Dynamic Type.

Apple/Google authentication has no backend flow, so it is explanatory footer text instead of an actionable-looking provider button. The previously approved verification placeholder is a noninteractive native labeled row with an explicit unavailable value and explanatory footer. Profile, avatar, password and My Places continue to use native Form/List.

The map keeps the iOS reference's 38pt avatar and existing three-row bookmark style. Actual user initials or the current account avatar replace the anonymous AA placeholder. The outline bookmark asset is retained; its selected state uses the native bookmark.fill symbol because the supplied iOS frame defines only the outline. Long text and accessibility fonts can grow and scroll.

Implementation references: [Apple Form](https://developer.apple.com/documentation/swiftui/form), [TextField](https://developer.apple.com/documentation/swiftui/textfield), [submitLabel](https://developer.apple.com/documentation/swiftui/view/submitlabel(_:)).

## I5 contribution presentation (2026-09-16)

Figma MCP rechecked `74:4744`: title, three category options, description, opening/closing time, optional photo and submit. The user's newer instruction that all UI/UX should be native carries forward the I4 decision: preserve these fields and entry points, use system fonts, grouped Form sections, DatePicker, PhotosPicker and navigation toolbar actions instead of the Web purple field styling. Existing category assets and the pen entry stay in the map shell.

The pen starts selection on the same MapKit instance; the center target maps to the geographic coordinate beneath the physical screen center, without extra coordinate conversion. Cancel returns to the existing draft when changing its location. A contribution sheet can be closed and reopened without losing fields or selected bytes. The detail edit action opens the same native form with the source content language and fixed coordinates.

Loading, retry, uncertain-edit confirmation and awaiting-review feedback are native text/progress/dialogs in the form. No public/private control, new main navigation, fake immediate approval or background-transfer promise is added. The toolbar stays reachable while the form scrolls, and title Return/keyboard Done dismiss input.
