import CoreLocation
import XCTest

/// Read-only acceptance against the existing local synthetic Rust stack.
/// Skips when that explicitly identified fixture stack is unavailable.
@MainActor
final class LivePlaceTests: LocalBackendTestCase {
  override func setUp() { continueAfterFailure = false }

  private func launch(resetLocation: Bool = false, allowLocation: Bool = false,
    initialCenter: String = "31.2304,121.4737") async throws -> XCUIApplication {
    do {
      let (data, response) = try await URLSession.shared.data(
        from: URL(string: "http://127.0.0.1:8080/api/markers/1?lang=en")!)
      guard (response as? HTTPURLResponse)?.statusCode == 200,
        String(decoding: data, as: UTF8.self).contains("S1 Synthetic Shanghai Center")
      else {
        throw XCTSkip("Local synthetic Rust fixture is not available")
      }
    } catch { throw XCTSkip("Local synthetic Rust fixture is not available: \(error)") }
    let app = XCUIApplication()
    if resetLocation { app.resetAuthorizationStatus(for: .location) }
    app.launchArguments = [
      "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-lycoris-test-center",
      initialCenter,
    ]
    app.launch()
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let permission = springboard.buttons.matching(NSPredicate(
      format: "label IN %@", allowLocation
        ? ["Allow While Using App", "使用App时允许", "使用 App 时允许"]
        : ["Don’t Allow", "Don't Allow", "不允许"])).firstMatch
    if resetLocation { XCTAssertTrue(permission.waitForExistence(timeout: 8)) }
    if permission.waitForExistence(timeout: 1) { permission.tap() }
    XCTAssertTrue(app.buttons["map.panel.handle"].waitForExistence(timeout: 10))
    return app
  }

  func testSearchDetailShareAndAppleMaps() async throws {
    let app = try await launch()
    let search = app.textFields["map.search"]
    search.tap()
    search.typeText("S1 Synthetic Shanghai Center")
    let row = app.buttons["place.row.1"]
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    attach(app, name: "i3-search-results")
    row.tap()
    XCTAssertTrue(app.staticTexts["place.title"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["place.title"].label, "S1 Synthetic Shanghai Center")
    XCTAssertTrue(
      app.staticTexts["Synthetic S1 fixture; not a real place or recommendation."].exists)
    XCTAssertFalse(app.images["PreviewPlacePhoto"].exists)
    attach(app, name: "i3-live-detail")
    app.buttons["Share"].tap()
    let copy = app.cells.matching(NSPredicate(format: "label IN %@", ["Copy", "拷贝", "复制"]))
      .firstMatch
    XCTAssertTrue(copy.waitForExistence(timeout: 5), app.debugDescription)
    attach(app, name: "i3-native-share")
    // Dismiss without sending or copying data.
    app.buttons["header.closeButton"].tap()
    XCTAssertTrue(app.buttons["Navigate"].waitForExistence(timeout: 5))
    app.buttons["Navigate"].tap()
    let maps = XCUIApplication(bundleIdentifier: "com.apple.Maps")
    let opened = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in maps.state == .runningForeground }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [opened], timeout: 10), .completed)
    app.activate()
    XCTAssertTrue(app.staticTexts["place.title"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["place.title"].label, "S1 Synthetic Shanghai Center")
  }

  func testRadarAndEveryCategoryUseNearbyWithDeniedLocation() async throws {
    let app = try await launch(resetLocation: true)
    XCTAssertFalse(app.alerts["Location unavailable"].exists)
    app.buttons["map.nearby"].tap()
    XCTAssertTrue(app.staticTexts["Around map center"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["place.row.1"].waitForExistence(timeout: 10))
    attach(app, name: "i3-nearby-radar-map-center")
    for (category, id) in [
      ("baby_room", "3"), ("friendly_clinic", "2"), ("accessible_toilet", "1"),
    ] {
      app.buttons["Close results"].tap()
      let card = app.buttons["map.category.\(category)"]
      if !card.isHittable {
        app.buttons["map.panel.handle"].tap()
      }
      XCTAssertTrue(card.waitForExistence(timeout: 5))
      card.tap()
      XCTAssertTrue(app.buttons["place.row.\(id)"].waitForExistence(timeout: 10))
      XCTAssertTrue(app.staticTexts["Around map center"].exists)
      attach(app, name: "i3-nearby-\(category)")
    }
  }

  func testSimulatedLocationAnchorsNearby() async throws {
    let previousLocation = XCUIDevice.shared.location
    defer { XCUIDevice.shared.location = previousLocation }
    XCUIDevice.shared.location = XCUILocation(
      location: CLLocation(latitude: 31.2304, longitude: 121.4737))
    let app = try await launch(resetLocation: true, allowLocation: true,
      initialCenter: "40.766,-74.077")
    // A fresh launch must locate and load the Shanghai pin before any map action.
    XCTAssertTrue(app.descendants(matching: .any)["map.pin.1"].waitForExistence(timeout: 20))
    attach(app, name: "startup-location-before-any-map-action")
    app.buttons["map.nearby"].tap()
    XCTAssertTrue(app.staticTexts["Around your location"].waitForExistence(timeout: 15))
    let row = app.buttons["place.row.1"]
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    XCTAssertTrue(row.label.contains("0m"), row.label)
    attach(app, name: "i3-nearby-simulated-location")
    row.tap()
    XCTAssertTrue(app.staticTexts["place.title"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["Straight-line distance from your location"].exists)
    XCTAssertTrue(app.staticTexts["0m"].exists)
    attach(app, name: "i3-detail-simulated-location")
  }

  func testEmptySearchThenReturnToHome() async throws {
    let app = try await launch()
    let search = app.textFields["map.search"]
    search.tap()
    search.typeText("NoSuchSyntheticPlaceXYZ987654")
    XCTAssertTrue(app.staticTexts["No places found."].waitForExistence(timeout: 10))
    attach(app, name: "i3-empty-search")
    app.buttons["Close results"].tap()
    XCTAssertTrue(app.buttons["map.category.accessible_toilet"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["No places found."].exists)
  }

  private func attach(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
