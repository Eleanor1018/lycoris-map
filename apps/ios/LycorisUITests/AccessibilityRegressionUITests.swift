import XCTest

/// Regression coverage for the five authorized accessibility fixes. Fixture-
/// backed cases run only against the identified loopback synthetic stack; no
/// real account, microphone permission or production write is used.
@MainActor final class AccessibilityRegressionUITests: LocalBackendTestCase {
  override func setUp() { continueAfterFailure = false }

  // MARK: - 3. Collapsed handle real 44pt target

  func testCollapsedHandleTargetsAndSearch() {
    let app = launchPreview(["collapsed"])
    let handle = app.buttons["map.panel.handle"]
    let search = app.textFields["map.search"]
    XCTAssertTrue(handle.waitForExistence(timeout: 10))
    attach(app, "collapsed-handle")

    // The real handle must be a true 44pt target, not an expanded AX frame.
    XCTAssertGreaterThanOrEqual(handle.frame.height, 44 - 0.5)
    XCTAssertEqual(handle.value as? String, "Collapsed")
    XCTAssertLessThanOrEqual(handle.frame.maxY, search.frame.minY + 1)
    XCTAssertGreaterThanOrEqual(handle.frame.minY, 0)

    // Each edge/center tap starts from Collapsed and must advance one detent to
    // Nearby. Returning to Collapsed follows the real three-detent order
    // (Collapsed → Nearby → Expanded → Collapsed).
    func tapRegion(_ dy: CGFloat) {
      handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: dy)).tap()
    }
    func returnToCollapsed() {
      tapRegion(0.5)
      expectValue(handle, "Expanded")
      tapRegion(0.5)
      expectValue(handle, "Collapsed")
    }

    tapRegion(0.5)
    expectValue(handle, "Nearby")
    returnToCollapsed()

    // Top edge and bottom edge are both inside the real target.
    tapRegion(0.03)
    expectValue(handle, "Nearby")
    returnToCollapsed()
    tapRegion(0.97)
    expectValue(handle, "Nearby")
    returnToCollapsed()

    // The handle must not steal the search field, account or voice taps.
    search.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
    search.typeText("library")
    search.typeText("\n")
    XCTAssertEqual(search.value as? String, "library")
    app.buttons["map.voice"].tap()
    denySystemSpeechPrompt()
    XCTAssertTrue(app.staticTexts["voice.status"].waitForExistence(timeout: 8))
    app.buttons["voice.cancel"].tap()
    app.buttons["map.account"].tap()
    XCTAssertTrue(app.alerts["Not available yet"].waitForExistence(timeout: 3))
    app.alerts.buttons["OK"].tap()
    XCTAssertTrue(handle.exists)
  }

  func testCollapsedHandleSpacingAtStandardAndChineseAccessibilityText() {
    for (name, language, largeText) in [("standard", "en", false), ("zh-AXXXL", "zh", true)] {
      let app = launchPreview(
        ["collapsed"], language: language, largeText: largeText, locale: language == "zh")
      let handle = app.buttons["map.panel.handle"]
      let search = app.textFields["map.search"]
      let voice = app.buttons["map.voice"]
      let account = app.buttons["map.account"]
      XCTAssertTrue(handle.waitForExistence(timeout: 10), name)
      // Real interactive buttons keep a 44pt target.
      XCTAssertGreaterThanOrEqual(handle.frame.height, 44 - 0.5, name)
      XCTAssertGreaterThanOrEqual(voice.frame.height, 44 - 0.5, name)
      XCTAssertGreaterThanOrEqual(voice.frame.width, 44 - 0.5, name)
      XCTAssertGreaterThanOrEqual(account.frame.height, 44 - 0.5, name)
      XCTAssertGreaterThanOrEqual(account.frame.width, 44 - 0.5, name)
      // The handle does not overlap the search row (the search TextField's own AX
      // frame is its content area, so only non-overlap and hit behavior matter).
      XCTAssertLessThanOrEqual(handle.frame.maxY, search.frame.minY + 1, name)
      XCTAssertTrue(search.isHittable, name)
      XCTAssertTrue(voice.isHittable, name)
      XCTAssertTrue(account.isHittable, name)
      // Typing still reaches the real field.
      search.tap()
      XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3), name)
      search.typeText("abc")
      XCTAssertEqual(search.value as? String, "abc", name)
      search.typeText("\n")
      attach(app, "collapsed-spacing-\(name)")
      app.terminate()
    }
  }

  // MARK: - 3b. Real drag and tap still work on the handle

  func testHandleStillSupportsDragAndStateChanges() {
    let app = launchPreview(["collapsed"])
    let handle = app.buttons["map.panel.handle"]
    XCTAssertTrue(handle.waitForExistence(timeout: 10))
    handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .press(
        forDuration: 0.15,
        thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.10)))
    expectValue(handle, "Expanded")
    attach(app, "handle-drag-expanded")
    handle.tap()
    expectValue(handle, "Collapsed")
  }

  // MARK: - 1. Category semantics from the loopback fixture

  func testCategorySemantics() throws {
    try requireAccessibilityFixture()
    let app = XCUIApplication()
    app.launchArguments = [
      "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
      "-lycoris-test-center", "31.2304,121.4737", "-lycoris.language", "en",
      "-lycoris.searchType", "all",
    ]
    app.launch()
    let search = app.textFields["map.search"]
    XCTAssertTrue(search.waitForExistence(timeout: 10))
    search.tap()
    search.typeText("Same Name Place")

    let toilet = app.buttons["place.row.11"]
    let nursing = app.buttons["place.row.12"]
    let medical = app.buttons["place.row.13"]
    XCTAssertTrue(toilet.waitForExistence(timeout: 8))
    XCTAssertTrue(nursing.waitForExistence(timeout: 8))
    XCTAssertTrue(medical.waitForExistence(timeout: 8))
    attach(app, "category-rows-en")

    let toiletLabel = toilet.label
    let nursingLabel = nursing.label
    let medicalLabel = medical.label
    // Three same-name places must still be distinguishable by category.
    XCTAssertNotEqual(toiletLabel, nursingLabel)
    XCTAssertNotEqual(nursingLabel, medicalLabel)
    XCTAssertNotEqual(toiletLabel, medicalLabel)
    XCTAssertTrue(toiletLabel.contains("Accessible Toilets"), toiletLabel)
    XCTAssertTrue(nursingLabel.contains("Nursing Rooms"), nursingLabel)
    XCTAssertTrue(medicalLabel.contains("Medical Institutions"), medicalLabel)
    for label in [toiletLabel, nursingLabel, medicalLabel] {
      XCTAssertTrue(label.contains("Same Name Place"), label)
      XCTAssertTrue(label.contains("09:00"), label)
    }
    // Each category point is exactly one operable button with a unique label.
    for (id, label) in [("11", toiletLabel), ("12", nursingLabel), ("13", medicalLabel)] {
      let rows = app.buttons.matching(identifier: "place.row.\(id)")
      XCTAssertEqual(rows.count, 1, id)
      XCTAssertTrue(rows.element.exists && rows.element.isHittable, id)
      XCTAssertEqual(rows.element.label, label, id)
    }
    XCTAssertEqual(
      Set([toiletLabel, nursingLabel, medicalLabel]).count, 3, "labels must be unique")

    // The category must also reach the UIKit pin label. Opening one place moves
    // the panel off Expanded so the map annotations are once again exposed.
    toilet.tap()
    XCTAssertTrue(app.staticTexts["place.title"].waitForExistence(timeout: 8))
    let enPin = app.descendants(matching: .any)["map.pin.11"]
    XCTAssertTrue(enPin.waitForExistence(timeout: 8))
    XCTAssertTrue(enPin.label.contains("Accessible Toilets"), enPin.label)
    XCTAssertTrue(enPin.label.contains("Same Name Place"), enPin.label)
    attach(app, "category-pin-en")

    // English and Chinese must differ and be correct.
    app.terminate()
    app.launchArguments = [
      "-AppleLanguages", "(\"zh-Hans\")", "-AppleLocale", "zh_Hans",
      "-lycoris-test-center", "31.2304,121.4737", "-lycoris.language", "zh",
      "-lycoris.searchType", "all",
    ]
    app.launch()
    let zhSearch = app.textFields["map.search"]
    XCTAssertTrue(zhSearch.waitForExistence(timeout: 10))
    zhSearch.tap()
    zhSearch.typeText("Same Name Place")
    let zhToilet = app.buttons["place.row.11"]
    XCTAssertTrue(zhToilet.waitForExistence(timeout: 8))
    attach(app, "category-rows-zh")
    let zhLabel = zhToilet.label
    XCTAssertNotEqual(zhLabel, toiletLabel)
    XCTAssertTrue(zhLabel.contains("无障碍卫生间"), zhLabel)
    XCTAssertTrue(zhLabel.contains("Same Name Place"), zhLabel)

    zhToilet.tap()
    XCTAssertTrue(app.staticTexts["place.title"].waitForExistence(timeout: 8))
    let zhPin = app.descendants(matching: .any)["map.pin.11"]
    XCTAssertTrue(zhPin.waitForExistence(timeout: 8))
    XCTAssertTrue(zhPin.label.contains("无障碍卫生间"), zhPin.label)
  }

  // MARK: - 2. Voice unavailable button is not "Stop recording"

  func testVoiceUnavailableState() {
    // resetAuthorizationStatus terminates a running app, so do it before launch.
    let app = previewApplication(["collapsed"])
    app.resetAuthorizationStatus(for: .microphone)
    app.launch()
    app.buttons["map.voice"].tap()
    denySystemSpeechPrompt()
    let status = app.staticTexts["voice.status"]
    XCTAssertTrue(status.waitForExistence(timeout: 8))
    attach(app, "voice-unavailable-panel")

    // Once unavailable, the button must present Close (never Stop recording).
    let trigger = app.buttons["map.voice"]
    let closed = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "label == %@", "Close voice search"), object: trigger)
    XCTAssertEqual(
      XCTWaiter.wait(for: [closed], timeout: 8), .completed,
      "Unavailable voice must offer Close, got \(trigger.label)")
    XCTAssertNotEqual(trigger.label, "Stop recording")

    // Tapping closes the voice panel and its status disappears.
    trigger.tap()
    let gone = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: status)
    XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 4), .completed)
    XCTAssertEqual(trigger.label, "Voice search")
  }

  // MARK: - 4 & 5. Large text tools and detail actions

  func testLargeTextDetailsAndTools() {
    // Chinese AXXXL: the localized copy is used throughout; identifiers keep the
    // lookups independent of the display language.
    let app = launchPreview(["details"], language: "zh", largeText: true, locale: true)
    let locate = app.buttons["map.locate"]
    XCTAssertTrue(locate.waitForExistence(timeout: 10))
    // Location tool keeps its real 48pt touch size at Chinese AXXXL.
    XCTAssertEqual(locate.frame.width, 48, accuracy: 1)
    XCTAssertEqual(locate.frame.height, 48, accuracy: 1)
    attach(app, "locate-tool-zh-AXXXL")

    // Expand the detail first, then scroll: assertions run before any audit.
    let handle = app.buttons["map.panel.handle"]
    handle.tap()
    let share = app.buttons["place.share"]
    XCTAssertTrue(share.waitForExistence(timeout: 5))
    let scroll = app.scrollViews["place.details"]
    let navigate = app.buttons["place.navigate"]
    let bookmark = app.buttons["place.bookmark"]
    for _ in 0..<8 {
      if share.isHittable && navigate.isHittable && bookmark.isHittable { break }
      scroll.swipeUp()
    }
    XCTAssertTrue(share.isHittable)
    XCTAssertTrue(navigate.isHittable)
    XCTAssertTrue(bookmark.isHittable)
    XCTAssertEqual(share.label, "分享")
    XCTAssertEqual(navigate.label, "导航")
    attach(app, "detail-actions-zh-AXXXL")
    // Tap Share in the preview: the localized native alert appears, then close it.
    share.tap()
    let alert = app.alerts.firstMatch
    XCTAssertTrue(alert.waitForExistence(timeout: 3))
    XCTAssertTrue(alert.label.contains("暂不可用"), alert.label)
    attach(app, "share-preview-alert-zh")
    alert.buttons.firstMatch.tap()
  }

  // MARK: - 5. Appearance of detail icons (screenshots only)

  func testDetailAppearance() {
    // The runner drives light and dark; screenshots must not assume one style.
    // English standard text: top Edit and bottom Share/Bookmark via identifiers.
    let app = launchPreview(["details"], language: "en", locale: false)
    XCTAssertTrue(app.buttons["place.edit"].waitForExistence(timeout: 10))
    attach(app, "detail-top-edit-en")
    let scroll = app.scrollViews["place.details"]
    for _ in 0..<8 {
      if app.buttons["place.share"].isHittable { break }
      scroll.swipeUp()
    }
    XCTAssertTrue(app.buttons["place.share"].isHittable)
    XCTAssertTrue(app.buttons["place.bookmark"].isHittable)
    attach(app, "detail-bottom-actions-en")
    app.terminate()

    // Chinese AXXXL appearance, same stable identifiers.
    let zh = launchPreview(["details"], language: "zh", largeText: true, locale: true)
    XCTAssertTrue(zh.buttons["place.edit"].waitForExistence(timeout: 10))
    attach(zh, "detail-top-edit-zh-AXXXL")
    let zhScroll = zh.scrollViews["place.details"]
    for _ in 0..<8 {
      if zh.buttons["place.share"].isHittable { break }
      zhScroll.swipeUp()
    }
    XCTAssertTrue(zh.buttons["place.share"].isHittable)
    attach(zh, "detail-bottom-actions-zh-AXXXL")
  }

  // MARK: - Helpers

  private func previewApplication(
    _ arguments: [String], language: String = "en", largeText: Bool = false, locale: Bool = false
  ) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-AppleLanguages", "(\(language))"]
    app.launchArguments += ["-AppleLocale", locale ? "zh_Hans" : "en_US"]
    app.launchArguments += ["-lycoris-preview"] + arguments
    app.launchArguments += ["-lycoris.language", language]
    if largeText {
      app.launchArguments += [
        "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
      ]
    }
    return app
  }

  private func launchPreview(
    _ arguments: [String], language: String = "en", largeText: Bool = false, locale: Bool = false
  ) -> XCUIApplication {
    let app = previewApplication(
      arguments, language: language, largeText: largeText, locale: locale)
    app.launch()
    return app
  }

  /// Deny the native speech/microphone prompt if the simulator presents one. The
  /// test never grants real microphone access and never fakes a transcript.
  private func denySystemSpeechPrompt() {
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let deny = springboard.buttons.matching(
      NSPredicate(format: "label IN %@", ["Don’t Allow", "Don't Allow", "不允许"])
    ).firstMatch
    if deny.waitForExistence(timeout: 3) { deny.tap() }
  }

  private func expectValue(_ element: XCUIElement, _ value: String, timeout: TimeInterval = 4) {
    let expectation = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value == %@", value), object: element)
    XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed)
  }

  private func requireAccessibilityFixture() throws {
    let url = URL(string: "http://127.0.0.1:8080/__ui_fixture")!
    let data = try Data(contentsOf: url)
    guard
      let fixture = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      fixture["fixture"] as? String == "lycoris-accessibility-regression"
    else {
      throw XCTSkip("Start scripts/accessibility-regression-fixture.py on loopback first")
    }
  }

  private func attach(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
