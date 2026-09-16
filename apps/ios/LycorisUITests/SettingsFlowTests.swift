import XCTest

@MainActor final class SettingsFlowTests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  private func launch(largeText: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
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
    XCTAssertTrue(app.buttons["settings.language"].waitForExistence(timeout: 5))
  }

  func testLanguageAndRadiusPersistAndUseNativeSettings() {
    let app = launch()
    expand(app)
    app.buttons["settings.language"].tap()
    app.buttons["简体中文"].tap()
    XCTAssertTrue(app.navigationBars["选择语言"].waitForExistence(timeout: 5))
    app.buttons["settings.done"].tap()
    XCTAssertTrue(app.staticTexts["搜索范围"].waitForExistence(timeout: 5))
    app.buttons["settings.range"].tap()
    app.buttons["settings.radius.2500"].tap()
    attach(app, "i6-native-range-zh")
    app.buttons["settings.done"].tap()
    XCTAssertTrue(app.staticTexts["2.5km"].exists)
    app.terminate()
    app.launch()
    expand(app)
    XCTAssertTrue(app.staticTexts["搜索范围"].exists)
    XCTAssertTrue(app.staticTexts["2.5km"].exists)
    attach(app, "i6-settings-persisted-zh")
    app.buttons["settings.source"].tap()
    XCTAssertTrue(app.staticTexts["Apple 地图"].exists)
    app.buttons["settings.done"].tap()
    app.buttons["settings.language"].tap()
    app.buttons["English"].tap()
    XCTAssertTrue(app.navigationBars["Choose Language"].waitForExistence(timeout: 5))
    app.buttons["settings.done"].tap()
    XCTAssertTrue(app.staticTexts["Searching Range"].waitForExistence(timeout: 5))
    app.buttons["settings.range"].tap()
    app.buttons["settings.radius.1000"].tap()
    app.buttons["settings.done"].tap()
    attach(app, "i6-settings-en")
  }

  func testLargeTextSettingsAndVoiceKeyboardFallback() {
    let app = launch(largeText: true)
    expand(app)
    let about = app.buttons["settings.about"]
    for _ in 0..<8 {
      if about.isHittable { break }
      app.scrollViews.firstMatch.swipeUp()
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
