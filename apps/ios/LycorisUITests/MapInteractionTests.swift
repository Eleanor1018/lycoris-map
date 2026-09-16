import XCTest

@MainActor
final class MapInteractionTests: XCTestCase {
  func testPanelDragKeyboardAndMapInteraction() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
    app.launch()
    let handle = app.buttons["map.panel.handle"]
    XCTAssertTrue(handle.waitForExistence(timeout: 10))
    XCTAssertEqual(handle.value as? String, "Collapsed")
    attach(app, name: "01-collapsed")

    app.buttons["map.nearby"].tap()
    XCTAssertTrue(NSPredicate(format: "value == %@", "Nearby").evaluate(with: handle))
    let mapStart = app.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.32))
    let mapEnd = app.coordinate(withNormalizedOffset: CGVector(dx: 0.68, dy: 0.50))
    mapStart.press(forDuration: 0.15, thenDragTo: mapEnd)
    XCTAssertEqual(handle.value as? String, "Nearby")
    attach(app, name: "02-map-panned-with-panel")

    handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .press(
        forDuration: 0.15,
        thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.10)))
    let expanded = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value == %@", "Expanded"), object: handle)
    XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 3), .completed)
    attach(app, name: "03-expanded")

    let search = app.textFields["map.search"]
    search.tap()
    search.typeText("library")
    XCTAssertEqual(search.value as? String, "library")
    XCTAssertTrue(search.isHittable)
    attach(app, name: "04-search-keyboard")
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 3))
    let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.48))
    let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.24))
    start.press(forDuration: 0.1, thenDragTo: end)
    let about = app.staticTexts["About Lycoris Maps"]
    XCTAssertTrue(about.isHittable)
    XCTAssertLessThan(about.frame.maxY, keyboard.frame.minY)
    attach(app, name: "05-content-scroll-with-keyboard")
    handle.tap()
    let collapsed = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value == %@", "Collapsed"), object: handle)
    XCTAssertEqual(XCTWaiter.wait(for: [collapsed], timeout: 3), .completed)
    XCTAssertEqual(search.value as? String, "library")
    attach(app, name: "06-collapsed-preserves-input")
  }

  private func attach(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
