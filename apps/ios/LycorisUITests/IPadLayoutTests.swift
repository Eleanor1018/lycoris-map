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
      let orientation = XCUIDevice.shared.orientation
      originalOrientation = orientation.isPortrait || orientation.isLandscape ? orientation : .portrait
      XCUIApplication().terminate()
      XCUIDevice.shared.orientation = .portrait
    }
  }

  override func tearDown() async throws {
    await MainActor.run {
      XCUIApplication().terminate()
      if let originalOrientation { XCUIDevice.shared.orientation = originalOrientation }
      originalOrientation = nil
    }
    try await super.tearDown()
  }

  func testAccessibilityTextKeepsSidebarAndSettingsReachable() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-lycoris.language", "en",
      "-lycoris-preview", "anonymousExpanded",
      "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
    ]
    app.launch()
    XCTAssertTrue(app.buttons["map.sidebar.search"].waitForExistence(timeout: 10))
    try waitForOrientation(.portrait, in: app)
    try rotate(.landscapeLeft, in: app)
    assertNavigationAndMap(app)
    XCTAssertGreaterThanOrEqual(app.buttons["map.sidebar.settings"].frame.height, 44)
    XCTAssertGreaterThanOrEqual(app.buttons["map.sidebar.account"].frame.height, 44)
    XCTAssertTrue(app.buttons["map.sidebar.close"].isHittable)
    attach(app, "ipad-accessibility-sidebar")

    app.buttons["map.sidebar.settings"].tap()
    let done = app.buttons["settings.home.done"]
    try require(done.waitForExistence(timeout: 8), "Settings did not open", in: app)
    let form = app.descendants(matching: .any).matching(identifier: "settings.home.form").firstMatch
    try require(form.waitForExistence(timeout: 5), "Settings form is missing", in: app)
    let about = app.buttons["settings.about"]
    // Native Form rows may not enter the accessibility tree until scrolled into view.
    for _ in 0..<4 {
      if about.exists && about.isHittable { break }
      form.swipeUp()
    }
    XCTAssertTrue(about.isHittable)
    XCTAssertTrue(done.isHittable)
    attach(app, "ipad-accessibility-settings")
    done.tap()
    XCTAssertTrue(done.waitForNonExistence(timeout: 5))
    XCTAssertTrue(app.buttons["map.sidebar.close"].waitForExistence(timeout: 5))
  }

  func testSearchCloseAndReopenPreservesQueryAndMap() async throws {
    try await resetFixture()
    let app = try launch()
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
    try rotate(.portrait, in: app)
    XCTAssertEqual(search.value as? String, "Metro Accessible Toilet")
    XCTAssertTrue(app.buttons["place.row.21"].isHittable)
    assertNavigationAndMap(app)
    attach(app, "ipad-search-reopened-portrait")
  }

  func testBothLandscapeLaunchesAcceptSearchAndSettingsTaps() async throws {
    try await resetFixture()
    for orientation in [UIDeviceOrientation.landscapeLeft, .landscapeRight] {
      let app = try launch(in: orientation)
      let search = app.textFields["map.search"]
      search.tap()
      search.typeText("Metro Accessible Toilet")
      try require(app.buttons["place.row.21"].waitForExistence(timeout: 8),
                  "Landscape launch search did not produce a result", in: app)
      app.buttons["map.sidebar.settings"].tap()
      let done = app.buttons["settings.home.done"]
      try require(done.waitForExistence(timeout: 5), "Landscape launch settings did not open", in: app)
      XCTAssertTrue(app.buttons["settings.language"].isHittable)
      XCTAssertTrue(done.isHittable)
      done.tap()
      XCTAssertTrue(done.waitForNonExistence(timeout: 5))
      XCTAssertEqual(search.value as? String, "Metro Accessible Toilet")
      attach(app, "ipad-cold-launch-\(orientation.rawValue)")
      app.terminate()
    }
  }

  func testNearbyDetailsSurviveRotationAndCloseKeepsNavigation() async throws {
    try await resetFixture()
    let app = try launch()
    app.buttons["map.category.baby_room"].tap()
    let row = app.buttons["place.row.23"]
    try require(row.waitForExistence(timeout: 8), "Nearby category did not produce its result", in: app)
    XCTAssertEqual(app.staticTexts["places.results.title"].label, "Nearby")
    XCTAssertFalse(app.buttons["place.row.21"].exists)
    row.tap()
    let title = app.staticTexts["place.title"]
    try require(title.waitForExistence(timeout: 5), "Nearby detail did not open", in: app)
    XCTAssertEqual(title.label, "Nursing Room No Tag")
    XCTAssertTrue(app.buttons["place.share"].isHittable)
    assertNavigationAndMap(app)
    attach(app, "ipad-nearby-detail-landscape")

    try rotate(.portrait, in: app)
    XCTAssertEqual(title.label, "Nursing Room No Tag")
    XCTAssertTrue(title.isHittable)
    XCTAssertTrue(app.buttons["place.navigate"].isHittable)
    assertNavigationAndMap(app)
    // Keep the first native share presentation after a portrait rotation.
    try assertNativeShareOpensAndCloses(in: app, detail: title)

    try rotate(.landscapeRight, in: app)
    XCTAssertEqual(title.label, "Nursing Room No Tag")
    attach(app, "ipad-detail-rotation-preserved")
    try assertNativeShareOpensAndCloses(in: app, detail: title)

    try rotate(.landscapeLeft, in: app)
    XCTAssertEqual(title.label, "Nursing Room No Tag")
    try assertNativeShareOpensAndCloses(in: app, detail: title)

    app.buttons["map.sidebar.close"].tap()
    XCTAssertTrue(content(in: app).waitForNonExistence(timeout: 5))
    XCTAssertFalse(title.exists)
    assertNavigationAndMap(app)
  }

  private func assertNativeShareOpensAndCloses(in app: XCUIApplication, detail: XCUIElement) throws {
    app.buttons["place.share"].tap()
    let copy = app.cells.matching(NSPredicate(format: "label IN %@", ["Copy", "拷贝", "复制"]))
      .firstMatch
    try require(copy.waitForExistence(timeout: 8), "Native share sheet did not open", in: app)
    attach(app, "ipad-native-share-sheet")
    let closeShare = app.buttons["header.closeButton"]
    // The detail remains in the AX tree behind the native share presentation.
    // Wait for the system sheet itself to disappear before rotating or closing the sidebar.
    for _ in 0..<3 {
      closeShare.tap()
      if closeShare.waitForNonExistence(timeout: 2) { break }
    }
    try require(!closeShare.exists, "Native share sheet did not dismiss", in: app)
    try require(detail.waitForExistence(timeout: 5) && detail.isHittable,
                "Detail did not become interactive after sharing", in: app)
  }

  func testNativeSettingsAndLoginExposeAuthenticatedBookmarks() async throws {
    try await resetFixture()
    let app = try launch()
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
    try signIn(app)
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
    let app = try launch()
    let search = app.textFields["map.search"]
    search.tap()
    search.typeText("Metro Accessible Toilet")
    let row = app.buttons["place.row.21"]
    try require(row.waitForExistence(timeout: 8), "Search did not produce the point to edit", in: app)
    row.tap()
    let edit = app.buttons["place.edit"]
    XCTAssertTrue(edit.waitForExistence(timeout: 5))
    edit.tap()
    try signIn(app)
    let title = app.textFields["contribution.title"]
    XCTAssertTrue(title.waitForExistence(timeout: 10))
    XCTAssertEqual(title.value as? String, "Metro Accessible Toilet")
    XCTAssertTrue(app.buttons["contribution.close"].isHittable)
    XCTAssertFalse(app.buttons["contribution.location"].exists)
    replace(title, with: "iPad rotation draft")
    title.typeText("\n")
    try rotate(.portrait, in: app)
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

  private func launch(in initialOrientation: UIDeviceOrientation = .portrait) throws -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-lycoris.language", "en",
      "-lycoris.searchType", "all", "-lycoris-test-center", "31.2304,121.4737",
    ]
    XCUIDevice.shared.orientation = initialOrientation
    app.launch()
    XCTAssertTrue(app.buttons["map.sidebar.search"].waitForExistence(timeout: 10))
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let allow = springboard.buttons.matching(
      NSPredicate(format: "label IN %@", ["Allow While Using App", "使用App时允许", "使用 App 时允许"])
    ).firstMatch
    if allow.waitForExistence(timeout: 2) { allow.tap() }
    try require(content(in: app).waitForExistence(timeout: 5), "Sidebar did not open", in: app)
    if initialOrientation.isLandscape {
      // Observe the launch result without sending a second orientation event.
      try waitForOrientation(initialOrientation, in: app)
    } else {
      try waitForOrientation(.portrait, in: app)
      try rotate(.landscapeLeft, in: app)
    }
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

  private func rotate(_ orientation: UIDeviceOrientation, in app: XCUIApplication) throws {
    XCUIDevice.shared.orientation = orientation
    try waitForOrientation(orientation, in: app)
  }

  private func waitForOrientation(_ orientation: UIDeviceOrientation, in app: XCUIApplication) throws {
    let isLandscape = orientation.isLandscape
    let settled = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in
        let frame = app.frame
        return isLandscape ? frame.width > frame.height : frame.height > frame.width
      }, object: app)
    try require(
      XCTWaiter.wait(for: [settled], timeout: 8) == .completed,
      "App window did not reach \(orientation.isLandscape ? "landscape" : "portrait") orientation",
      in: app)
  }

  private func signIn(_ app: XCUIApplication) throws {
    let username = app.textFields["auth.username"]
    XCTAssertTrue(username.waitForExistence(timeout: 8))
    replace(username, with: "ios_metadata_fixture")
    let password = app.secureTextFields["auth.password"]
    replace(password, with: "Metadata-Fixture-1")
    password.typeText("\n")
    try dismissPasswordSaveAlert(in: app)
  }

  private struct InteractionFailure: Error {}

  private func require(
    _ condition: Bool, _ message: String, in app: XCUIApplication,
    file: StaticString = #filePath, line: UInt = #line
  ) throws {
    guard condition else {
      attach(app, message)
      XCTFail(message, file: file, line: line)
      throw InteractionFailure()
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
