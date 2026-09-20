import XCTest

/// Run scripts/account-regression-fixture.py first. Uses controlled network delays,
/// not production credentials or writes. Rust auth has its own integration suite.
@MainActor final class AccountRegressionUITests: LocalBackendTestCase {
  override func setUp() { continueAfterFailure = false }

  func testColdEditShowsNativeLoadingWithoutOpeningContribution() async throws {
    try await configure(["reset": true])
    let app = launch()
    try await openPlace(app)
    try await configure(["detailDelay": 3])
    app.buttons["place.edit"].tap()
    XCTAssertTrue(app.activityIndicators["contribution.loading"].waitForExistence(timeout: 2))
    attach(app, "cold-edit-loading")
    let title = app.textFields["contribution.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 8))
    XCTAssertEqual(title.value as? String, "Cold Edit Fixture")
    attach(app, "cold-edit-native-form")
    app.buttons["contribution.close"].tap()
    XCTAssertTrue(app.buttons["place.edit"].waitForExistence(timeout: 3))
  }

  func testBookmarkFillsBeforeDelayedOwnerCheckCompletes() async throws {
    try await configure(["reset": true])
    let app = launch()
    try await openPlace(app)
    try await configure(["identityDelay": 4])
    let bookmark = app.buttons["place.bookmark"]
    XCTAssertEqual(bookmark.label, "Bookmark place")
    bookmark.tap()
    let saved = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "label == %@", "Remove bookmark"), object: bookmark)
    let savedResult = await XCTWaiter.fulfillment(of: [saved], timeout: 2)
    XCTAssertEqual(savedResult, .completed)
    attach(app, "bookmark-blue-immediate-feedback")
    let ready = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "enabled == true"), object: bookmark)
    let readyResult = await XCTWaiter.fulfillment(of: [ready], timeout: 8)
    XCTAssertEqual(readyResult, .completed)
    bookmark.tap()
    let removed = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "label == %@", "Bookmark place"), object: bookmark)
    let removedResult = await XCTWaiter.fulfillment(of: [removed], timeout: 2)
    XCTAssertEqual(removedResult, .completed)
  }

  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-lycoris-test-center",
      "31.2304,121.4737", "-lycoris.language", "en",
    ]
    app.launch()
    XCTAssertTrue(app.buttons["map.panel.handle"].waitForExistence(timeout: 10))
    return app
  }

  private func openPlace(_ app: XCUIApplication) async throws {
    let search = app.textFields["map.search"]
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap()
    search.typeText("Cold Edit Fixture")
    let row = app.buttons["place.row.1"]
    XCTAssertTrue(row.waitForExistence(timeout: 8))
    row.tap()
    let bookmark = app.buttons["place.bookmark"]
    XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
    let ready = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "enabled == true"), object: bookmark)
    let readyResult = await XCTWaiter.fulfillment(of: [ready], timeout: 5)
    XCTAssertEqual(readyResult, .completed)
  }

  private func configure(_ fields: [String: Any]) async throws {
    let url = URL(string: "http://127.0.0.1:8080/__ui_fixture")!
    let session = URLSession(configuration: .ephemeral)
    let (data, response) = try await session.data(from: url)
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      let fixture = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      fixture["fixture"] as? String == "lycoris-account-regression"
    else { throw XCTSkip("Start scripts/account-regression-fixture.py on loopback first") }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = try JSONSerialization.data(withJSONObject: fields)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let (_, updated) = try await session.data(for: request)
    XCTAssertEqual((updated as? HTTPURLResponse)?.statusCode, 200)
  }

  private func attach(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
