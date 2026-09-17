import XCTest

@MainActor final class MapAppearanceTests: LocalBackendTestCase {
  override func setUp() { continueAfterFailure = false }

  func testMapStylePersistsAndCardDismissesBackToMap() {
    let app = launch()
    app.buttons["map.appearance"].tap()
    let satellite = app.buttons["map.appearance.satellite"]
    XCTAssertTrue(satellite.waitForExistence(timeout: 5))
    satellite.tap()
    XCTAssertTrue(satellite.isSelected)
    attach(app, "map-style-card-satellite")
    app.buttons["map.appearance.close"].tap()
    XCTAssertTrue(app.buttons["map.locate"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.buttons["map.panel.handle"].value as? String, "Collapsed")
    attach(app, "map-style-satellite-map")
    app.terminate()
    app.launch()
    app.buttons["map.appearance"].tap()
    XCTAssertTrue(satellite.waitForExistence(timeout: 5))
    XCTAssertTrue(satellite.isSelected)
    app.buttons["map.appearance.explore"].tap()
    app.buttons["map.appearance.close"].tap()
    // The zoom source must remain usable after presentation and dismissal.
    app.buttons["map.appearance"].tap()
    XCTAssertTrue(app.buttons["map.appearance.explore"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["map.appearance.explore"].isSelected)
    app.buttons["map.appearance.close"].tap()
  }

  func testMapStyleCardSupportsAccessibilityText() {
    let app = launch(largeText: true)
    app.buttons["map.appearance"].tap()
    let satellite = app.buttons["map.appearance.satellite"]
    XCTAssertTrue(satellite.waitForExistence(timeout: 5))
    for _ in 0..<5 {
      if satellite.isHittable { break }
      app.scrollViews.firstMatch.swipeUp()
    }
    XCTAssertTrue(satellite.isHittable)
    satellite.tap()
    XCTAssertTrue(satellite.isSelected)
    attach(app, "map-style-accessibility-size")
    XCTAssertTrue(app.buttons["map.appearance.close"].isHittable)
    app.buttons["map.appearance.close"].tap()
  }

  private func launch(largeText: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-lycoris-preview", "collapsed",
    ]
    if largeText {
      app.launchArguments += [
        "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
      ]
    }
    app.launch()
    XCTAssertTrue(app.buttons["map.appearance"].waitForExistence(timeout: 10))
    return app
  }

  private func attach(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
