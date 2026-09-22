import UIKit
import XCTest

/// Run on an iPad with scripts/place-metadata-fixture.py and the Test build
/// configuration. These cases exercise the real stores through loopback HTTP;
/// design previews intentionally do not execute search or account requests.
@MainActor final class IPadLayoutTests: LocalBackendTestCase {
  private let base = URL(string: "http://127.0.0.1:8080")!
  private var originalOrientation: UIDeviceOrientation?

  override func setUp() async throws {
    try await super.setUp()
    // XCTest also invokes the inherited setUpWithError(), retaining the
    // LocalBackendTestCase guard against non-Test configurations.
    try await MainActor.run {
      continueAfterFailure = false
      guard UIDevice.current.userInterfaceIdiom == .pad else {
        throw XCTSkip("This suite verifies the native iPad sidebar layout.")
      }
      originalOrientation = XCUIDevice.shared.orientation
      XCUIDevice.shared.orientation = .landscapeLeft
    }
  }

  override func tearDown() async throws {
    await MainActor.run {
      if let originalOrientation { XCUIDevice.shared.orientation = originalOrientation }
      originalOrientation = nil
    }
    try await super.tearDown()
  }

  func testAccessibilityTextKeepsSidebarAndSettingsReachable() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-lycoris.language", "en",
      "-lycoris-preview", "anonymousExpanded",
      "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
    ]
    app.launch()
    XCTAssertTrue(app.buttons["map.sidebar.search"].waitForExistence(timeout: 10))
    assertNavigationAndMap(app)
    XCTAssertGreaterThanOrEqual(app.buttons["map.sidebar.settings"].frame.height, 44)
    XCTAssertGreaterThanOrEqual(app.buttons["map.sidebar.account"].frame.height, 44)
    XCTAssertTrue(app.buttons["map.sidebar.close"].isHittable)
    attach(app, "ipad-accessibility-sidebar")

    app.buttons["map.sidebar.settings"].tap()
    let about = app.buttons["settings.about"]
    XCTAssertTrue(about.waitForExistence(timeout: 8))
    for _ in 0..<4 {
      if about.isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(about.isHittable)
    XCTAssertTrue(app.buttons["settings.home.done"].isHittable)
    attach(app, "ipad-accessibility-settings")
    app.buttons["settings.home.done"].tap()
    XCTAssertTrue(app.buttons["map.sidebar.close"].waitForExistence(timeout: 5))
  }

  func testSearchCloseAndReopenPreservesQueryAndMap() async throws {
    try await resetFixture()
    let app = launch()
    XCTAssertFalse(app.buttons["map.sidebar.bookmarks"].exists)
    let search = app.textFields["map.search"]
    search.tap()
    search.typeText("Metro Accessible Toilet")
    XCTAssertTrue(app.buttons["place.row.21"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.buttons["map.voice"].exists)
    attach(app, "ipad-search-keyboard")

    app.buttons["map.sidebar.close"].tap()
    XCTAssertTrue(content(in: app).waitForNonExistence(timeout: 5))
    XCTAssertFalse(search.exists)
    assertNavigationAndMap(app)
    XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
    attach(app, "ipad-content-closed")

    app.buttons["map.sidebar.search"].tap()
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    XCTAssertEqual(search.value as? String, "Metro Accessible Toilet")
    XCTAssertTrue(app.buttons["place.row.21"].waitForExistence(timeout: 5))
    rotate(.portrait, in: app)
    XCTAssertEqual(search.value as? String, "Metro Accessible Toilet")
    XCTAssertTrue(app.buttons["place.row.21"].isHittable)
    assertNavigationAndMap(app)
    attach(app, "ipad-search-reopened-portrait")
  }

  func testNearbyDetailsSurviveRotationAndCloseKeepsNavigation() async throws {
    try await resetFixture()
    let app = launch()
    app.buttons["map.category.baby_room"].tap()
    let row = app.buttons["place.row.23"]
    XCTAssertTrue(row.waitForExistence(timeout: 8))
    XCTAssertEqual(app.staticTexts["places.results.title"].label, "Nearby")
    XCTAssertFalse(app.buttons["place.row.21"].exists)
    row.tap()
    let title = app.staticTexts["place.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    XCTAssertEqual(title.label, "Nursing Room No Tag")
    XCTAssertTrue(app.buttons["place.share"].isHittable)
    assertNavigationAndMap(app)
    attach(app, "ipad-nearby-detail-landscape")

    rotate(.portrait, in: app)
    XCTAssertEqual(title.label, "Nursing Room No Tag")
    XCTAssertTrue(title.isHittable)
    XCTAssertTrue(app.buttons["place.navigate"].isHittable)
    assertNavigationAndMap(app)
    // Verify the system sheet in portrait as well as the landscape detail.
    app.buttons["place.share"].tap()
    let copy = app.cells.matching(NSPredicate(format: "label IN %@", ["Copy", "拷贝", "复制"]))
      .firstMatch
    XCTAssertTrue(copy.waitForExistence(timeout: 8))
    attach(app, "ipad-native-share-sheet")
    app.buttons["header.closeButton"].tap()
    XCTAssertTrue(title.waitForExistence(timeout: 5))

    rotate(.landscapeRight, in: app)
    XCTAssertEqual(title.label, "Nursing Room No Tag")
    attach(app, "ipad-detail-rotation-preserved")

    app.buttons["map.sidebar.close"].tap()
    XCTAssertTrue(content(in: app).waitForNonExistence(timeout: 5))
    XCTAssertFalse(title.exists)
    assertNavigationAndMap(app)
  }

  func testNativeSettingsAndLoginExposeAuthenticatedBookmarks() async throws {
    try await resetFixture()
    let app = launch()
    XCTAssertFalse(app.buttons["map.sidebar.bookmarks"].exists)
    app.buttons["map.sidebar.settings"].tap()
    let language = app.buttons["settings.language"]
    XCTAssertTrue(language.waitForExistence(timeout: 5))
    language.tap()
    XCTAssertTrue(app.navigationBars["Choose Language"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["settings.done"].isHittable)
    attach(app, "ipad-native-settings-sheet")
    app.buttons["settings.done"].tap()
    XCTAssertTrue(app.buttons["settings.done"].waitForNonExistence(timeout: 5))
    let closeSettings = app.buttons["settings.home.done"]
    XCTAssertTrue(closeSettings.waitForExistence(timeout: 5))
    closeSettings.tap()
    XCTAssertTrue(closeSettings.waitForNonExistence(timeout: 5))

    app.buttons["map.sidebar.account"].tap()
    signIn(app)
    XCTAssertTrue(app.buttons["profile.avatar"].waitForExistence(timeout: 8))
    app.buttons["account.close"].tap()
    let bookmarks = app.buttons["map.sidebar.bookmarks"]
    XCTAssertTrue(bookmarks.waitForExistence(timeout: 5))
    bookmarks.tap()
    XCTAssertTrue(content(in: app).waitForExistence(timeout: 5))
    XCTAssertFalse(app.textFields["auth.username"].exists)
    let savedPlace = app.buttons["place.row.22"]
    XCTAssertTrue(savedPlace.waitForExistence(timeout: 8))
    XCTAssertTrue(savedPlace.isHittable)
    XCTAssertFalse(app.buttons["place.row.21"].exists)
    assertNavigationAndMap(app)
    attach(app, "ipad-authenticated-bookmarks-content")
    savedPlace.tap()
    let title = app.staticTexts["place.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    XCTAssertEqual(title.label, "School Accessible Toilet")
    XCTAssertEqual(app.buttons["place.bookmark"].label, "Remove bookmark")
    XCTAssertTrue(app.buttons["place.share"].isHittable)
    attach(app, "ipad-bookmark-detail")
    app.buttons["map.sidebar.close"].tap()
    XCTAssertTrue(content(in: app).waitForNonExistence(timeout: 5))
    XCTAssertFalse(title.exists)
    assertNavigationAndMap(app)
    bookmarks.tap()
    XCTAssertTrue(savedPlace.waitForExistence(timeout: 5))
  }

  func testContributionEditorRemainsModalAndRetainsDraftAcrossRotation() async throws {
    try await resetFixture()
    let app = launch()
    let search = app.textFields["map.search"]
    search.tap()
    search.typeText("Metro Accessible Toilet")
    let row = app.buttons["place.row.21"]
    XCTAssertTrue(row.waitForExistence(timeout: 8))
    row.tap()
    let edit = app.buttons["place.edit"]
    XCTAssertTrue(edit.waitForExistence(timeout: 5))
    edit.tap()
    signIn(app)
    let title = app.textFields["contribution.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 10))
    XCTAssertEqual(title.value as? String, "Metro Accessible Toilet")
    XCTAssertTrue(app.buttons["contribution.close"].isHittable)
    XCTAssertFalse(app.buttons["contribution.location"].exists)
    replace(title, with: "iPad rotation draft")
    title.typeText("\n")
    rotate(.portrait, in: app)
    XCTAssertEqual(title.value as? String, "iPad rotation draft")
    XCTAssertTrue(app.buttons["contribution.close"].isHittable)
    attach(app, "ipad-native-contribution-portrait")

    app.buttons["contribution.close"].tap()
    XCTAssertTrue(title.waitForNonExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["place.title"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["place.title"].label, "Metro Accessible Toilet")
    assertNavigationAndMap(app)
    edit.tap()
    XCTAssertTrue(title.waitForExistence(timeout: 8))
    XCTAssertEqual(title.value as? String, "iPad rotation draft")
    app.buttons["contribution.close"].tap()
  }

  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-lycoris.language", "en",
      "-lycoris.searchType", "all", "-lycoris-test-center", "31.2304,121.4737",
    ]
    app.launch()
    XCTAssertTrue(app.buttons["map.sidebar.search"].waitForExistence(timeout: 10))
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let allow = springboard.buttons.matching(
      NSPredicate(format: "label IN %@", ["Allow While Using App", "使用App时允许", "使用 App 时允许"])
    ).firstMatch
    if allow.waitForExistence(timeout: 2) { allow.tap() }
    XCTAssertTrue(content(in: app).waitForExistence(timeout: 5))
    return app
  }

  private func content(in app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: "map.sidebar.content").firstMatch
  }

  private func assertNavigationAndMap(
    _ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
  ) {
    for identifier in ["search", "contribute", "settings", "account"] {
      XCTAssertTrue(app.buttons["map.sidebar.\(identifier)"].isHittable, identifier, file: file, line: line)
    }
    XCTAssertTrue(app.maps.firstMatch.exists, file: file, line: line)
    XCTAssertTrue(app.maps.firstMatch.isHittable, file: file, line: line)
  }

  private func rotate(_ orientation: UIDeviceOrientation, in app: XCUIApplication) {
    XCUIDevice.shared.orientation = orientation
    let isLandscape = orientation.isLandscape
    let settled = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in
        let frame = app.frame
        return isLandscape ? frame.width > frame.height : frame.height > frame.width
      }, object: app)
    XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 8), .completed)
  }

  private func signIn(_ app: XCUIApplication) {
    let username = app.textFields["auth.username"]
    XCTAssertTrue(username.waitForExistence(timeout: 8))
    replace(username, with: "ios_metadata_fixture")
    let password = app.secureTextFields["auth.password"]
    replace(password, with: "Metadata-Fixture-1")
    password.typeText("\n")
    for host in [app, XCUIApplication(bundleIdentifier: "com.apple.springboard")] {
      let notNow = host.buttons.matching(
        NSPredicate(format: "label IN %@", ["Not Now", "以后", "以后再说"])
      ).firstMatch
      if notNow.waitForExistence(timeout: 2) {
        notNow.tap()
        break
      }
    }
  }

  private func replace(_ field: XCUIElement, with value: String) {
    field.tap()
    if let current = field.value as? String, current != field.placeholderValue, !current.isEmpty {
      field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
    }
    field.typeText(value)
  }

  private func resetFixture() async throws {
    let (data, response) = try await URLSession.shared.data(
      from: base.appendingPathComponent("__ui_fixture"))
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      let fixture = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      fixture["fixture"] as? String == "lycoris-place-metadata"
    else { throw XCTSkip("Start scripts/place-metadata-fixture.py on loopback first.") }
    var request = URLRequest(url: base.appendingPathComponent("__ui_fixture/reset"))
    request.httpMethod = "POST"
    let (_, updated) = try await URLSession.shared.data(for: request)
    XCTAssertEqual((updated as? HTTPURLResponse)?.statusCode, 200)
  }

  private func attach(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
