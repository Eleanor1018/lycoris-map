import XCTest

@MainActor final class SettingsFlowTests: LocalBackendTestCase {
  override func setUp() { continueAfterFailure = false }

  private func launch(largeText: Bool = false, englishOverride: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
    if englishOverride { app.launchArguments += ["-lycoris.language", "en"] }
    if largeText {
      app.launchArguments += [
        "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
      ]
    }
    app.launch()
    XCTAssertTrue(app.buttons["map.panel.handle"].waitForExistence(timeout: 10))
    return app
  }

  private func expand(_ app: XCUIApplication) {
    let handle = app.buttons["map.panel.handle"]
    handle.tap()
    handle.tap()
    XCTAssertTrue(app.collectionViews["map.panel.content"].waitForExistence(timeout: 5))
  }

  func testLanguageAndRadiusPersistAndUseNativeSettings() {
    let app = launch()
    expand(app)
    app.buttons["settings.language"].tap()
    app.buttons["简体中文"].tap()
    XCTAssertTrue(app.navigationBars["选择语言"].waitForExistence(timeout: 5))
    app.buttons["settings.done"].tap()
    XCTAssertEqual(app.buttons["settings.range"].label, "搜索范围")
    app.buttons["settings.range"].tap()
    setRadius("2500", in: app)
    app.buttons["settings.keyboard-done"].tap()
    attach(app, "i6-native-range-zh")
    app.buttons["settings.done"].tap()
    XCTAssertEqual(app.buttons["settings.range"].value as? String, "2.5km")
    app.terminate()
    app.launch()
    expand(app)
    XCTAssertEqual(app.buttons["settings.range"].label, "搜索范围")
    XCTAssertEqual(app.buttons["settings.range"].value as? String, "2.5km")
    app.buttons["settings.range"].tap()
    XCTAssertEqual(app.textFields["settings.radius.custom"].value as? String, "2500")
    setRadius("50001", in: app)
    app.buttons["settings.done"].tap()
    XCTAssertEqual(app.buttons["settings.range"].value as? String, "2.5km")
    app.buttons["settings.range"].tap()
    setRadius("", in: app)
    app.buttons["settings.keyboard-done"].tap()
    XCTAssertEqual(app.textFields["settings.radius.custom"].value as? String, "2500")
    app.buttons["settings.done"].tap()
    attach(app, "i6-settings-persisted-zh")
    app.buttons["settings.source"].tap()
    XCTAssertTrue(app.staticTexts["Apple 地图"].exists)
    app.buttons["settings.done"].tap()
    app.buttons["settings.language"].tap()
    app.buttons["English"].tap()
    XCTAssertTrue(app.navigationBars["Choose Language"].waitForExistence(timeout: 5))
    app.buttons["settings.done"].tap()
    XCTAssertEqual(app.buttons["settings.range"].label, "Searching Range")
    app.buttons["settings.range"].tap()
    setRadius("1000", in: app)
    // Pull the sheet down while editing, without Apply or either Done action.
    app.navigationBars["Searching Range"].coordinate(
      withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
    )
    .press(
      forDuration: 0.1,
      thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)))
    XCTAssertTrue(app.buttons["settings.done"].waitForNonExistence(timeout: 5))
    XCTAssertEqual(app.buttons["settings.range"].value as? String, "1km")
    attach(app, "i6-settings-en")
  }

  private func setRadius(_ value: String, in app: XCUIApplication) {
    let field = app.textFields["settings.radius.custom"]
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    if let current = field.value as? String, current != field.placeholderValue, !current.isEmpty {
      field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
    }
    if !value.isEmpty { field.typeText(value) }
  }

  func testLargeTextSettingsAndVoiceKeyboardFallback() {
    let app = launch(largeText: true)
    expand(app)
    let about = app.buttons["settings.about"]
    for _ in 0..<8 {
      if about.isHittable { break }
      app.collectionViews["map.panel.content"].swipeUp()
    }
    XCTAssertTrue(about.isHittable)
    about.tap()
    attach(app, "i6-about-accessibility-size")
    XCTAssertTrue(app.buttons["settings.done"].isHittable)
    app.buttons["settings.done"].tap()
    app.buttons["map.voice"].tap()
    // Simulator may not have a local speech model. Never fake a transcription.
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let deny = springboard.buttons.matching(
      NSPredicate(format: "label IN %@", ["Don’t Allow", "Don't Allow", "不允许"])
    ).firstMatch
    if deny.waitForExistence(timeout: 3) { deny.tap() }
    XCTAssertTrue(app.staticTexts["voice.status"].waitForExistence(timeout: 5))
    let keyboard = app.buttons["voice.keyboard"]
    for _ in 0..<4 {
      if keyboard.isHittable { break }
      app.swipeUp()
    }
    attach(app, "i6-voice-native-fallback")
    keyboard.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    XCTAssertTrue(app.textFields["map.search"].isHittable)
  }

  func testSearchTypeUsesNativePickerAndPersists() {
    let app = launch(englishOverride: true)
    expand(app)
    let rows = ["language", "searchType", "range", "source", "about"]
    for row in rows {
      XCTAssertEqual(app.buttons["settings.\(row)"].frame.height, 44, accuracy: 1)
    }
    app.buttons["settings.searchType"].tap()
    for type in ["all", "toilet", "nursing", "medical"] {
      XCTAssertTrue(app.buttons["settings.searchType.\(type)"].exists)
    }
    app.buttons["settings.searchType.nursing"].tap()
    attach(app, "native-search-type-picker")
    app.buttons["settings.done"].tap()
    XCTAssertEqual(app.buttons["settings.searchType"].value as? String, "Nursing Rooms")
    app.terminate()
    app.launch()
    expand(app)
    XCTAssertEqual(app.buttons["settings.searchType"].value as? String, "Nursing Rooms")
    attach(app, "native-settings-search-type-persisted")
    app.buttons["settings.searchType"].tap()
    XCTAssertTrue(app.buttons["settings.searchType.nursing"].isSelected)
    app.buttons["settings.searchType.all"].tap()
    app.buttons["settings.done"].tap()
    XCTAssertEqual(app.buttons["settings.searchType"].value as? String, "All")
  }

  func testPublicPlaceLinkColdAndWarmLaunch() async throws {
    let (data, response) = try await URLSession.shared.data(
      from: URL(string: "http://127.0.0.1:8080/api/markers/1?lang=en")!)
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      String(decoding: data, as: UTF8.self).contains("S1 Synthetic Shanghai Center")
    else {
      throw XCTSkip("Local synthetic fixture stack unavailable")
    }
    let app = launch()
    app.terminate()
    app.open(URL(string: "lycoris://maps?markerId=1")!)
    let title = app.staticTexts["place.title"]
    guard title.waitForExistence(timeout: 12) else {
      XCTFail(app.debugDescription)
      return
    }
    XCTAssertEqual(title.label, "S1 Synthetic Shanghai Center")
    attach(app, "i6-place-link-cold-launch")
    app.buttons["Share"].tap()
    XCTAssertTrue(app.buttons["header.closeButton"].waitForExistence(timeout: 5))
    attach(app, "i6-native-share-link")
    app.buttons["header.closeButton"].tap()
    app.open(URL(string: "lycoris://maps?markerId=2")!)
    let changed = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "label != %@", "S1 Synthetic Shanghai Center"), object: title)
    let result = await XCTWaiter.fulfillment(of: [changed], timeout: 10)
    XCTAssertEqual(result, .completed)
    app.open(URL(string: "lycoris://maps?markerId=0")!)
    XCTAssertTrue(app.alerts["Could not open place link"].waitForExistence(timeout: 5))
  }

  private func attach(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
