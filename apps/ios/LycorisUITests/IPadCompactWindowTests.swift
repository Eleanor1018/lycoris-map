import UIKit
import XCTest

/// Run on the iPad mini (A17 Pro), whose full-screen rotation crosses the
/// 760pt layout boundary: 744pt portrait and 1133pt landscape. Uses only reads
/// from scripts/place-metadata-fixture.py in the isolated Test configuration.
@MainActor final class IPadCompactWindowTests: LocalBackendTestCase {
  private var originalOrientation: UIDeviceOrientation?

  override func setUp() async throws {
    try await super.setUp()
    // The inherited setUpWithError() retains the Test-configuration guard.
    try await MainActor.run {
      continueAfterFailure = false
      guard UIDevice.current.userInterfaceIdiom == .pad else {
        throw XCTSkip("Run this layout-transition case on an iPad mini (A17 Pro).")
      }
      originalOrientation = XCUIDevice.shared.orientation
      XCUIDevice.shared.orientation = .portrait
    }
  }

  override func tearDown() async throws {
    await MainActor.run {
      if let originalOrientation { XCUIDevice.shared.orientation = originalOrientation }
      originalOrientation = nil
    }
    try await super.tearDown()
  }

  func testSearchAndSelectedPlaceSurviveCompactWideRoundTrips() async throws {
    try await requireFixture()
    let app = XCUIApplication()
    app.launchArguments = [
      "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-lycoris.language", "en",
      "-lycoris.searchType", "all", "-lycoris-test-center", "31.2304,121.4737",
    ]
    app.launch()
    XCTAssertTrue(app.textFields["map.search"].waitForExistence(timeout: 10))
    guard abs(app.frame.width - 744) < 1, abs(app.frame.height - 1133) < 1 else {
      throw XCTSkip("Requires the iPad mini's 744 × 1133pt full-screen portrait window.")
    }
    allowLocationIfRequested()
    assertLayout(in: app, wide: false)

    let query = "Metro Accessible Toilet"
    let search = app.textFields["map.search"]
    search.tap()
    search.typeText(query)
    let row = app.buttons["place.row.21"]
    XCTAssertTrue(row.waitForExistence(timeout: 8))
    XCTAssertEqual(search.value as? String, query)
    attach(app, "ipad-mini-compact-search")

    rotate(.landscapeLeft, in: app, wide: true)
    XCTAssertEqual(app.frame.width, 1133, accuracy: 1)
    XCTAssertEqual(search.value as? String, query)
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    XCTAssertTrue(row.isHittable)
    attach(app, "ipad-mini-wide-search")

    rotate(.portrait, in: app, wide: false)
    XCTAssertEqual(search.value as? String, query)
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    XCTAssertTrue(row.isHittable)
    row.tap()
    assertSelectedPlace(in: app)
    attach(app, "ipad-mini-compact-selected-place")

    rotate(.landscapeRight, in: app, wide: true)
    assertSelectedPlace(in: app)
    XCTAssertTrue(app.maps.firstMatch.isHittable)
    attach(app, "ipad-mini-wide-selected-place")

    rotate(.portrait, in: app, wide: false)
    assertSelectedPlace(in: app)
    attach(app, "ipad-mini-compact-selected-place-restored")
  }

  private func assertLayout(in app: XCUIApplication, wide: Bool) {
    let sidebar = app.buttons["map.sidebar.search"]
    let panel = app.buttons["map.panel.handle"]
    XCTAssertTrue((wide ? sidebar : panel).waitForExistence(timeout: 5))
    XCTAssertTrue((wide ? panel : sidebar).waitForNonExistence(timeout: 5))
    XCTAssertTrue((wide ? sidebar : panel).isHittable)
  }

  private func assertSelectedPlace(in app: XCUIApplication) {
    let title = app.staticTexts["place.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    XCTAssertEqual(title.label, "Metro Accessible Toilet")
    for identifier in ["place.share", "place.navigate", "place.bookmark", "place.edit"] {
      let action = app.buttons[identifier]
      let ready = XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "exists == true AND hittable == true"), object: action)
      XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed, identifier)
    }
  }

  private func rotate(
    _ orientation: UIDeviceOrientation, in app: XCUIApplication, wide: Bool
  ) {
    XCUIDevice.shared.orientation = orientation
    let settled = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in
        let frame = app.frame
        return wide ? frame.width > frame.height : frame.height > frame.width
      }, object: app)
    XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 8), .completed)
    assertLayout(in: app, wide: wide)
  }

  private func allowLocationIfRequested() {
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let allow = springboard.buttons.matching(
      NSPredicate(format: "label IN %@", ["Allow While Using App", "使用App时允许", "使用 App 时允许"])
    ).firstMatch
    if allow.waitForExistence(timeout: 2) { allow.tap() }
  }

  private func requireFixture() async throws {
    let url = URL(string: "http://127.0.0.1:8080/__ui_fixture")!
    let (data, response) = try await URLSession.shared.data(from: url)
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      let fixture = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      fixture["fixture"] as? String == "lycoris-place-metadata"
    else { throw XCTSkip("Start scripts/place-metadata-fixture.py on loopback first.") }
  }

  private func attach(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
