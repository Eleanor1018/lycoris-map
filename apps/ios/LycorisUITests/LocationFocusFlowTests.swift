import CoreLocation
import XCTest

/// Exercises real MapKit following while the landmark calibration always fails.
@MainActor final class LocationFocusFlowTests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  func testStartupAndLocateAfterPanningWorkWithoutCalibration() throws {
    #if !LYCORIS_LOCAL_TESTS
      throw XCTSkip("This regression must run in the isolated Test configuration.")
    #else
      let previousLocation = XCUIDevice.shared.location
      defer { XCUIDevice.shared.location = previousLocation }
      XCUIDevice.shared.location = XCUILocation(
        location: CLLocation(latitude: 31.2304, longitude: 121.4737))
      let app = XCUIApplication()
      app.resetAuthorizationStatus(for: .location)
      app.launchArguments = [
        "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        "-lycoris-test-center", "40.766,-74.077", "-lycoris-test-map-calibration-unavailable",
      ]
      app.launch()
      let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
      let allow = springboard.buttons.matching(
        NSPredicate(
          format: "label IN %@",
          ["Allow While Using App", "使用App时允许", "使用 App 时允许"])
      ).firstMatch
      XCTAssertTrue(allow.waitForExistence(timeout: 10))
      allow.tap()
      let map = app.descendants(matching: .any)["map.canvas"].firstMatch
      XCTAssertTrue(map.waitForExistence(timeout: 10))
      expect(map, contains: ["tracking=1", "calibration=unresolved"])
      expectLocationCentered(in: map, app: app)
      attach(app, name: "startup-native-location-with-failed-calibration")

      let start = map.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.3))
      let end = map.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.3))
      start.press(forDuration: 0.1, thenDragTo: end)
      expect(map, contains: ["tracking=0", "calibration=unresolved"])
      let locate = app.buttons["map.locate"]
      XCTAssertGreaterThanOrEqual(locate.frame.width, 44)
      XCTAssertGreaterThanOrEqual(locate.frame.height, 44)
      // The full control must respond, including its padding around the glyph.
      locate.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
      expect(map, contains: ["tracking=1", "calibration=unresolved"])
      expectLocationCentered(in: map, app: app)
      XCTAssertFalse(app.alerts["Location unavailable"].exists)
      attach(app, name: "locate-after-pan-with-failed-calibration")
    #endif
  }

  private func expect(_ element: XCUIElement, contains values: [String]) {
    let predicate = NSPredicate { _, _ in
      let value = element.value as? String ?? ""
      return values.allSatisfy(value.contains)
    }
    let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
    XCTAssertEqual(
      XCTWaiter.wait(for: [expectation], timeout: 20), .completed,
      "Expected \(values), got \(String(describing: element.value))")
  }

  private func expectLocationCentered(in map: XCUIElement, app: XCUIApplication) {
    // Inspect the rendered native annotation, not a delegate-time visibility
    // snapshot that can precede MapKit's layout of the blue dot.
    let location = app.otherElements["My Location"].firstMatch
    let predicate = NSPredicate { _, _ in
      guard location.exists else { return false }
      let frame = location.frame
      let bounds = map.frame
      return !frame.isEmpty && bounds.contains(frame)
        && abs(frame.midX - bounds.midX) < bounds.width * 0.1
        && abs(frame.midY - bounds.midY) < bounds.height * 0.15
    }
    XCTAssertEqual(
      XCTWaiter.wait(
        for: [XCTNSPredicateExpectation(predicate: predicate, object: location)], timeout: 20),
      .completed, "The native location annotation should be visible near the map center.")
  }

  private func attach(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
