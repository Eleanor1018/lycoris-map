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

## Native UI for missing designs (updated 2026-09-17)

The user has confirmed that components absent from Figma must use iOS-native controls and system presentation. Within the approved feature scope, use SwiftUI Form/List, NavigationStack, system sheets, pickers, alerts and semantic styles without requiring a new visual-design decision for each missing component. Existing Figma components and subsequent explicit layout refinements remain the reference. This does not add new features or imply that unsupported backend capabilities are available.

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

The user's 2026-09-17 refinement changes selection to an explicit tap-to-place mode on the same MapKit instance. The map panel hides, native Cancel and location controls remain at the top, and a compact material-backed confirmation sits at the bottom. A single tap places an MKMarkerAnnotationView at the touched coordinate, with selection haptics; another tap moves the same pin. Native pan, pinch and double-tap zoom keep its geographic coordinate fixed. Confirmation opens the form; it does not submit a proposal. VoiceOver adds a native “Select map center” action. When changing a draft location, its saved pin is shown first; Cancel returns to the draft without changing its coordinate or fields. A contribution sheet can be closed and reopened without losing fields or selected bytes. The detail edit action opens the same native form with the source content language and fixed coordinates.

Loading, retry, uncertain-edit confirmation and awaiting-review feedback are native text/progress/dialogs in the form. No public/private control, new main navigation, fake immediate approval or background-transfer promise is added. The toolbar stays reachable while the form scrolls, and title Return/keyboard Done dismiss input.

## I6 settings and system experience (2026-09-16)

Figma MCP rechecked `45:248`: retain Choose Language, Searching Range, Map Source and About in the original order and the existing map panel. The user's 2026-09-17 refinement replaces separate rounded cards with one native inset-grouped List section, system separators and 44pt rows at standard text sizes. Accessibility text grows instead of clipping. Search Type is added after language, with the confirmed All / Accessible Toilets / Nursing Rooms / Medical Institutions choices in a native inline Picker. Settings is a heading, without the old nonfunctional heading arrow. Apple Maps replaces the OSM source value according to the approved iOS provider choice. Each row opens native NavigationStack/Form content; there are no new main tabs or theme controls.

The newest all-native UI preference also governs voice input: a native form shows recording, permission or unsupported state, confirmed text, and system toolbar actions. The microphone and visible 38pt avatar gain 44pt targets. The panel grabber uses a 44pt interaction area (the visual capsule stays 48×4), with panel geometry adjusted accordingly. The anonymous AA design sample becomes a native person symbol. Accessibility text sizes use one-column categories and stacked distance/hours, while normal sizes preserve the reference layout. Reduced transparency uses an opaque semantic panel background; reduced motion keeps nonanimated map/panel transitions.

Computer Use on iPhone 17 Pro verified expanded Chinese/English settings, native language selection, a stable map during language changes and the actual unsupported voice state. Automated iPhone 17 screenshots cover native range settings, persistence, largest accessibility text, native sharing and cold-link opening. These verify the implementation's system-adaptive layouts, not pixel identity with the fixed Figma status-bar sketch. Real-device recording and spoken VoiceOver traversal remain I7 experience work.

## Expanded panel refinement (2026-09-17)

The user's follow-up changes the fully expanded panel to an edge-attached surface, using Apple Maps on the iOS 26.5 simulator as the interaction reference. Horizontal inset interpolates from 25pt collapsed through 10pt nearby to 0pt expanded. The upper corners remain rounded; the lower corners become square at full expansion, extending the background through the home-indicator region. When large text merges Nearby and Expanded, that transition stays continuous. The grabber is centered in every state.

Map and detail scrolling explicitly own their bottom safe area once. With the keyboard visible, the home-indicator space already included in its height is not added again to the content. The last row/actions remain scrollable and reachable. Short anonymous content can naturally leave unused panel space; rows are not enlarged or populated with new content to fill it.

Verified with 6 PanelLayout tests and 3 map interaction UI flows on iPhone 17, including full-width bounds, merged detents, large text, keyboard scrolling and details. Computer Use on iPhone 17 Pro compared Apple Maps, verified the new expanded surface, and restored Simplified Chinese. Log: `/tmp/lycoris-ios-panel-edges.log`; screenshots: task `outputs/ios-panel-edges`.

## Collapsed panel spacing refinement (2026-09-17)

The collapsed search row now has equal 14pt space above and below it. A separate collapsed header height removes the excess upper space without changing Nearby or Expanded geometry. The grabber region interpolates from 14pt collapsed to its full 44pt height as the panel opens; the search, microphone and account controls retain their existing sizes and Dynamic Type behavior.

Verified with the 6 PanelLayout tests and 3 map interaction UI flows, including keyboard scrolling and preserving search text after collapse. Computer Use on iPhone 17 Pro confirmed the visual balance, dragged directly from the compact grabber to Expanded, and returned to Collapsed. Log: `/tmp/lycoris-ios-collapsed-spacing2.log`.

## Nearby width and heading alignment refinement (2026-09-17)

The user's next refinement extends the edge-attached surface to Nearby. Horizontal inset and bottom corner radius now interpolate from 25pt/26pt at Collapsed to zero at Nearby and stay zero through Expanded; the top corners remain rounded. The wider category cards use their existing typography and internal padding. Settings explicitly uses the same 6pt header inset inside the List's 17pt content margin as Find Nearby and Bookmarks. Native setting rows retain their separate 16pt internal inset and 44pt standard height. Detail photo height now uses the full-width panel's actual 15pt photo margins on each side.

Verified with 6 existing PanelLayout tests, keyboard/drag interaction and bookmark/detail presentation flows on iPhone 17. The exported Nearby and Expanded simulator screenshots confirm the edge-attached panel and aligned section headings. Xcode Run built the updated normal Debug app on iPhone 17 Pro. Logs: `/tmp/lycoris-nearby-edge.log`, `/tmp/lycoris-nearby-detail.log`.

## Map style card (2026-09-17)

The user requested Apple Maps' expanding map-style card from the existing map icon, then narrowed the choices to Explore and Satellite. Computer Use inspected the iOS 26.5 Apple Maps card: a compact bottom sheet, thumbnail choices, selection outline and trailing close button. Lycoris uses native NavigationStack, Button, sheet detents/material and the system zoom transition from the icon. Accessibility text switches to a scrollable single column with medium/large detents.

Explore selects MKStandardMapConfiguration; Satellite selects MKHybridMapConfiguration to retain road labels over Apple's imagery. Switching only updates preferredConfiguration on the persistent MKMapView, preserves camera/pins and saves the preference. The map-source settings page still identifies Apple Maps. Thumbnail images come from MKMapSnapshotter at the opening map center, match their actual cell dimensions and retain native attribution; unavailable previews use SF Symbols while the style remains selectable. There are no added traffic or transit options.

Nine model/MapKit tests passed, covering preference restoration and invalid-value fallback, camera/annotation preservation and existing preferences/links. Two native UI flows passed for switching, restart persistence, repeated presentation/dismissal and largest accessibility text. Final captures: task `outputs/ios-map-style`; logs: `/tmp/lycoris-ios-map-appearance-two-options.log` and `/tmp/lycoris-ios-map-appearance-previews-final.log`.

Public API references: [Map configurations](https://developer.apple.com/documentation/mapkit/mkmapview/preferredconfiguration), [snapshot configuration](https://developer.apple.com/documentation/mapkit/mkmapsnapshotter/options/preferredconfiguration), [system zoom transitions](https://developer.apple.com/videos/play/wwdc2024/10145/). The card is composed with public system controls, not a private Apple Maps view.

Visual limitation: on this simulator, the New Jersey reference area shows blurred/flat satellite ground with labels rather than complete photographic tiles. Computer Use also opened Apple Maps on the same iPhone 17 Pro, searched the same public reference coordinates and selected Satellite with labels; its imagery remained incomplete too. Configuration and UI behavior are verified, but photographic tile delivery is not accepted as complete. No specific network/provider cause has been established; recheck imagery on a physical device or when the service becomes available.
