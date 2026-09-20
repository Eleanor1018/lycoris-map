# iOS accessibility P2 fixes

2026-09-20. Scope: the five confirmed application defects from the accessibility review of `03f20e4`. Wen directed the changes and reviewed implementation, screenshots and test results; Sue implemented them with the existing OpenCode Go DeepSeek V4.1 Flash executor.

| Defect | Change | Regression evidence |
| --- | --- | --- |
| Category missing from place row / map pin labels | A shared, app-language-aware label includes category, name, available spoken distance and hours. The row remains a single actionable Button. | Three same-name places with different categories; English and Chinese row/pin labels; tapping rows opens details. |
| Unavailable voice search says Stop recording | The label, symbol, enabled state and action use the recording controller state. Unavailable/denied/failed states offer Close; recording offers Stop; finishing is disabled Recognizing. | All controller states in unit tests; unavailable UI closes through its own button. |
| Collapsed handle is only 14pt tall | A real 44pt Button extends upward from the unchanged visible handle, outside the clipped panel. Search padding stays unchanged. | Center and both edge taps, panel dragging, search typing, voice/account taps and English/Chinese maximum-size layout. |
| Location icon overflows at maximum text size | Fixed 20pt tool glyph within its existing 48pt touch target. | Chinese accessibility XXXL in light/dark; frame assertions and screenshot review. |
| Detail action images stay black in dark mode | Edit, Bookmark and action assets use template rendering with the native foreground. The prominent Navigate arrow retains its native white foreground. | Light/dark and standard/maximum-size screenshots; maximum-size actions remain hittable and Share is activated. |

## Verified result

- 28 unit tests across the accessibility, panel layout, preferences/link and place data suites passed.
- 10 distinct UI regression cases passed across the targeted runs; two detail cases also passed in dark appearance (12 passing case/appearance combinations).
- The first light run exposed an accessibility wrapper that moved a row label off its Button and a test that incorrectly treated the TextField content frame as its outer hit region. The wrapper and assertion were corrected; the three affected/related cases passed in the scoped rerun.
- No accessibility audit handler was used to suppress failures in these regression tests. Screenshot review confirmed adaptive action icons and a contained location arrow. UI hit checks precede any system audit and Share is actually activated.

## Reproduce

Use the **Test** configuration, which addresses the loopback fixture. Normal Debug/Release runs still use the real HTTPS service. No production account or content mutations are needed for these checks.

Start the synthetic fixture in a separate terminal from `apps/ios`, provided port 8080 is free:

```sh
python3 scripts/accessibility-regression-fixture.py
```

Run the targeted tests with a booted iPhone simulator:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project Lycoris.xcodeproj -scheme Lycoris -configuration Test \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath /tmp/lycoris-ios-accessibility-build \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- SWIFT_EMIT_LOC_STRINGS=NO \
  -parallel-testing-enabled NO \
  -only-testing:LycorisTests/AccessibilityRegressionTests \
  -only-testing:LycorisTests/PanelLayoutTests \
  -only-testing:LycorisTests/PreferencesAndLinkTests \
  -only-testing:LycorisTests/PlaceDataTests \
  -only-testing:LycorisUITests/AccessibilityRegressionUITests \
  -only-testing:LycorisUITests/MapInteractionTests/testCollapsedSearchRowAndPaddingDragWithoutStealingTaps \
  -only-testing:LycorisUITests/MapInteractionTests/testAccessibilityTextKeepsDetailActionsReachable \
  -only-testing:LycorisUITests/MapInteractionTests/testBookmarkPreviewOpensAndDismissesDetails \
  test
```

Repeat only `testDetailAppearance` and `testLargeTextDetailsAndTools` in dark appearance, then restore the simulator's prior appearance. Stop your fixture process afterward. Test screenshots are retained in the xcresult attachments.

## Verification boundary

These checks inspect accessibility labels, real hit regions, UI actions and rendered appearance on iPhone 17 / iOS 26.5 Simulator. They do not certify every app flow for VoiceOver. Physical-device spoken output and focus restoration, Voice Control, Switch Control, Full Keyboard Access, iPad and system preference combinations remain separate manual checks. No app attribution or system accessibility elements were hidden to silence audit warnings. The removed visual distance explanation remains removed.
