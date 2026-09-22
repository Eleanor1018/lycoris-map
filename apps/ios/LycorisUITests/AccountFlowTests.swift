import XCTest

/// Only the loopback synthetic Rust stack is eligible for these write tests.
/// A dedicated random fixture account is reused from the test runner's private container.
@MainActor
final class AccountFlowTests: LocalBackendTestCase {
  private struct Fixture: Codable {
    let username: String
    let email: String
    let password: String
  }
  private let base = URL(string: "http://127.0.0.1:8080")!
  override func setUp() { continueAfterFailure = false }

  func testAccountBookmarkRestoreProfileAndLogout() async throws {
    try await requireSyntheticStack()
    let fixture = fixtureAccount()
    let app = launch()
    openAccount(app)
    logoutIfNeeded(app)
    XCTAssertTrue(app.textFields["auth.username"].waitForExistence(timeout: 8))
    attach(app, "i4-login")
    XCTAssertFalse(app.buttons["Continue with Apple"].exists)
    XCTAssertTrue(
      app.staticTexts[
        "Apple and Google login are not enabled yet. Please use your account password."
      ].exists)

    let session = URLSession(configuration: .ephemeral)
    let (_, status) = try await request(
      session, "api/login", fields: ["username": fixture.username, "password": fixture.password])
    guard status == 200 else {
      throw XCTSkip(
        "Seed a verified loopback fixture and supply LYCORIS_I4_FIXTURE_JSON; unverified auto-registration is no longer supported."
      )
    }
    fill(app.textFields["auth.username"], fixture.username)
    fill(app.secureTextFields["auth.password"], fixture.password)
    app.secureTextFields["auth.password"].typeText("\n")
    XCTAssertTrue(app.buttons["profile.save"].waitForExistence(timeout: 12), app.debugDescription)
    declinePasswordSave(app)
    let profileReady = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "hittable == true"), object: app.textFields["profile.nickname"]
    )
    guard await XCTWaiter.fulfillment(of: [profileReady], timeout: 5) == .completed else {
      XCTFail("The profile should be reachable after dismissing the system password prompt")
      return
    }
    fill(app.textFields["profile.nickname"], "I4 Native Fixture")
    fill(app.textFields["profile.pronouns"], "they/them")
    app.buttons["profile.save"].tap()
    XCTAssertTrue(app.staticTexts["Profile saved."].waitForExistence(timeout: 8))
    app.swipeDown()
    attach(app, "i4-profile")
    app.buttons["account.close"].tap()

    let search = app.textFields["map.search"]
    fill(search, "S1 Synthetic Shanghai Center")
    XCTAssertTrue(app.buttons["place.row.1"].waitForExistence(timeout: 10))
    app.buttons["place.row.1"].tap()
    let bookmark = app.buttons["place.bookmark"]
    XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
    waitEnabled(bookmark)
    if bookmark.label == "Remove bookmark" {
      bookmark.tap()
      waitLabel(bookmark, "Bookmark place")
    }
    bookmark.tap()
    waitLabel(bookmark, "Remove bookmark")
    attach(app, "i4-saved-place")

    app.terminate()
    app.launch()
    openAccount(app)
    XCTAssertTrue(app.buttons["profile.save"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.textFields["profile.nickname"].value as? String, "I4 Native Fixture")
    app.buttons["Bookmarks"].tap()
    XCTAssertTrue(app.buttons["place.row.1"].waitForExistence(timeout: 8))
    attach(app, "i4-bookmarks")
    app.buttons["place.row.1"].tap()
    XCTAssertTrue(app.staticTexts["place.title"].waitForExistence(timeout: 5))
    app.buttons["place.bookmark"].tap()
    waitLabel(app.buttons["place.bookmark"], "Bookmark place")
    let handle = app.buttons["map.panel.handle"]
    handle.tap()
    let expanded = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in
        handle.value as? String == "Expanded" && handle.frame.minY < 100
      }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 5), .completed)
    handle.tap()
    XCTAssertTrue(app.textFields["map.search"].waitForExistence(timeout: 5))
    openAccount(app)
    app.buttons["profile.logout"].tap()
    XCTAssertTrue(app.textFields["auth.username"].waitForExistence(timeout: 8))
    app.buttons["account.close"].tap()
    expand(app)
    XCTAssertFalse(app.buttons["map.bookmarks.heading"].exists)
    attach(app, "i4-logout-hidden-bookmarks")
    app.terminate()
    app.launch()
    openAccount(app)
    XCTAssertTrue(app.textFields["auth.username"].waitForExistence(timeout: 8))
    app.buttons["account.close"].tap()
  }

  func testAuthDynamicTypeAndRegistrationPlaceholder() async throws {
    try await requireSyntheticStack()
    let app = launch(largeText: true)
    openAccount(app)
    logoutIfNeeded(app)
    XCTAssertTrue(app.buttons["auth.switch"].waitForExistence(timeout: 8))
    app.buttons["auth.switch"].tap()
    let providerNote = app.staticTexts[
      "Apple and Google login are not enabled yet. Please use your account password."
    ]
    for _ in 0..<8 {
      if providerNote.isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(providerNote.isHittable)
    XCTAssertFalse(app.buttons["Continue with Google"].exists)
    attach(app, "native-auth-register-large-type")
    XCTAssertTrue(app.buttons["account.close"].isHittable)
    app.buttons["account.close"].tap()
  }

  func testNativeRegistrationKeyboardAndBackNavigation() async throws {
    try await requireSyntheticStack()
    let app = launch()
    openAccount(app)
    logoutIfNeeded(app)
    app.buttons["auth.switch"].tap()
    let email = app.textFields["auth.email"]
    XCTAssertTrue(email.waitForExistence(timeout: 5))
    email.tap()
    email.typeText("keyboard@example.invalid\n")
    app.typeText("keyboard_fixture\n")
    XCTAssertEqual(app.textFields["auth.username"].value as? String, "keyboard_fixture")
    app.typeText("1")
    let password = app.secureTextFields["auth.password"]
    XCTAssertNotEqual(password.value as? String, password.placeholderValue)
    password.typeText("\n")
    XCTAssertTrue(email.exists)
    XCTAssertFalse(app.buttons["auth.submit"].isEnabled)
    attach(app, "native-auth-register")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.textFields["auth.username"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.textFields["auth.email"].exists)
    let loginPassword = app.secureTextFields["auth.password"]
    XCTAssertEqual(loginPassword.value as? String, loginPassword.placeholderValue)
    attach(app, "native-auth-login")
    app.buttons["account.close"].tap()
  }

  func testPrivatePlacesPasswordAndAvatarPicker() async throws {
    try await requireSyntheticStack()
    let fixture = fixtureAccount()
    let session = URLSession(configuration: .ephemeral)
    let (_, loginStatus) = try await request(
      session, "api/login", fields: ["username": fixture.username, "password": fixture.password])
    guard loginStatus == 200 else { throw XCTSkip("Run the account registration flow first") }
    var creation = URLRequest(url: base.appendingPathComponent("api/markers"))
    creation.httpMethod = "POST"
    creation.setValue("application/json", forHTTPHeaderField: "Content-Type")
    creation.httpBody = try JSONSerialization.data(withJSONObject: [
      "lat": 31.231, "lng": 121.475, "category": "accessible_toilet",
      "title": "I4 Synthetic Private Place",
      "description": "Local iOS account fixture, not a real place.",
      "language": "en", "isPublic": false, "clientRequestId": "i4-\(fixture.username)",
    ])
    let (createdData, createdResponse) = try await session.data(for: creation)
    XCTAssertEqual((createdResponse as? HTTPURLResponse)?.statusCode, 200)
    let created = try XCTUnwrap(JSONSerialization.jsonObject(with: createdData) as? [String: Any])
    let id = try XCTUnwrap(created["id"] as? Int)
    let app = launch()
    openAccount(app)
    logoutIfNeeded(app)
    fill(app.textFields["auth.username"], fixture.username)
    fill(app.secureTextFields["auth.password"], fixture.password)
    app.buttons["auth.submit"].tap()
    XCTAssertTrue(app.buttons["profile.avatar"].waitForExistence(timeout: 10))
    declinePasswordSave(app)
    let avatarReady = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "hittable == true AND enabled == true"),
      object: app.buttons["profile.avatar"])
    guard await XCTWaiter.fulfillment(of: [avatarReady], timeout: 5) == .completed else {
      XCTFail("The avatar picker should be reachable after the system password prompt closes")
      return
    }
    app.buttons["profile.avatar"].tap()
    let photo = app.images.matching(
      NSPredicate(
        format: "label BEGINSWITH 'Photo,' OR label BEGINSWITH '照片，' OR label BEGINSWITH '照片,'")
    ).firstMatch
    guard photo.waitForExistence(timeout: 8) else {
      XCTFail(app.debugDescription)
      return
    }
    attach(app, "i4-native-photo-picker")
    // Photos exposes the thumbnail as an accessibility image without a hit point.
    photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    guard app.buttons["profile.save"].waitForExistence(timeout: 8) else {
      XCTFail(app.debugDescription)
      return
    }
    waitEnabled(app.buttons["profile.save"])
    var hasAvatar = false
    for _ in 0..<30 {
      let (data, _) = try await session.data(from: base.appendingPathComponent("api/me"))
      let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any]
      hasAvatar = (envelope?["data"] as? [String: Any])?["avatarUrl"] is String
      if hasAvatar { break }
      try await Task.sleep(for: .milliseconds(100))
    }
    XCTAssertTrue(hasAvatar)
    app.buttons["Change password"].tap()
    fill(app.secureTextFields["password.old"], fixture.password)
    fill(app.secureTextFields["password.new"], fixture.password)
    fill(app.secureTextFields["password.confirm"], fixture.password)
    app.buttons["password.submit"].tap()
    XCTAssertTrue(
      app.staticTexts["Password changed."].waitForExistence(timeout: 10), app.debugDescription)
    attach(app, "i4-password-updated")
    let (_, staleSessionResponse) = try await session.data(
      from: base.appendingPathComponent("api/me"))
    XCTAssertEqual((staleSessionResponse as? HTTPURLResponse)?.statusCode, 401)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.buttons["My Places"].tap()
    let row = app.buttons["place.row.\(id)"]
    XCTAssertTrue(row.waitForExistence(timeout: 8))
    XCTAssertFalse(app.staticTexts["Password changed."].exists)
    XCTAssertTrue(app.staticTexts["Private"].exists)
    XCTAssertTrue(app.staticTexts["Pending review"].exists)
    attach(app, "i4-my-private-places")
    row.tap()
    XCTAssertTrue(app.staticTexts["place.title"].waitForExistence(timeout: 8))
    XCTAssertEqual(app.staticTexts["place.title"].label, "I4 Synthetic Private Place")
    XCTAssertTrue(app.buttons["place.bookmark"].waitForExistence(timeout: 8))
    attach(app, "i4-owned-private-detail")
    app.terminate()
    app.launch()
    openAccount(app)
    logoutIfNeeded(app)
    app.buttons["account.close"].tap()
    XCTAssertFalse(app.otherElements["map.pin.\(id)"].exists)
  }

  func testSaveAfterLoginAndSecondAccountIsolation() async throws {
    try await requireSyntheticStack()
    let fixture = fixtureAccount(key: "lycoris.i4.second-account")
    let session = URLSession(configuration: .ephemeral)
    let (_, status) = try await request(
      session, "api/login", fields: ["username": fixture.username, "password": fixture.password])
    guard status == 200 else {
      throw XCTSkip(
        "Seed a distinct verified loopback fixture and supply LYCORIS_I4_SECOND_FIXTURE_JSON.")
    }
    var remove = URLRequest(url: base.appendingPathComponent("api/markers/1/favorite"))
    remove.httpMethod = "DELETE"
    _ = try await session.data(for: remove)
    let app = launch()
    openAccount(app)
    logoutIfNeeded(app)
    app.buttons["account.close"].tap()
    fill(app.textFields["map.search"], "S1 Synthetic Shanghai Center")
    XCTAssertTrue(app.buttons["place.row.1"].waitForExistence(timeout: 10))
    app.buttons["place.row.1"].tap()
    let bookmark = app.buttons["place.bookmark"]
    XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
    waitEnabled(bookmark)
    bookmark.tap()
    XCTAssertTrue(app.textFields["auth.username"].waitForExistence(timeout: 5))
    fill(app.textFields["auth.username"], fixture.username)
    fill(app.secureTextFields["auth.password"], fixture.password)
    app.buttons["auth.submit"].tap()
    declinePasswordSave(app)
    waitLabel(bookmark, "Remove bookmark")
    XCTAssertFalse(app.buttons["account.close"].exists)
    attach(app, "i4-login-resumes-save")
    app.terminate()
    app.launch()
    openAccount(app)
    XCTAssertTrue(app.buttons["profile.avatar"].waitForExistence(timeout: 8))
    XCTAssertEqual(app.textFields["profile.nickname"].value as? String, fixture.username)
    app.buttons["My Places"].tap()
    XCTAssertTrue(app.staticTexts["No places yet."].waitForExistence(timeout: 8))
    XCTAssertFalse(app.staticTexts["I4 Synthetic Private Place"].exists)
    attach(app, "i4-second-account-isolation")
    app.buttons["account.close"].tap()
    openAccount(app)
    logoutIfNeeded(app)
    app.buttons["account.close"].tap()
    _ = try await session.data(for: remove)
  }

  private func declinePasswordSave(_ app: XCUIApplication) {
    // This native Passwords sheet is not exposed as an XCTest alert on iOS 26.5.
    // Decline only the synthetic test account prompt; never save test credentials.
    for host in [app, XCUIApplication(bundleIdentifier: "com.apple.springboard")] {
      let later = host.buttons.matching(
        NSPredicate(format: "label IN %@", ["Not Now", "以后", "以后再说"])
      ).firstMatch
      if later.waitForExistence(timeout: 2) {
        later.tap()
        return
      }
    }
  }

  private func launch(largeText: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-lycoris-test-center",
      "31.2304,121.4737",
    ]
    if largeText {
      app.launchArguments += [
        "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
      ]
    }
    app.launch()
    XCTAssertTrue(app.buttons["map.panel.handle"].waitForExistence(timeout: 10))
    return app
  }

  private func openAccount(_ app: XCUIApplication) {
    let account = app.buttons["map.account"]
    XCTAssertTrue(account.waitForExistence(timeout: 5))
    account.tap()
  }

  private func logoutIfNeeded(_ app: XCUIApplication) {
    if app.buttons["profile.avatar"].waitForExistence(timeout: 2) {
      for _ in 0..<12 {
        if app.buttons["profile.logout"].isHittable { break }
        app.swipeUp()
      }
      app.buttons["profile.logout"].tap()
      XCTAssertTrue(app.textFields["auth.username"].waitForExistence(timeout: 8))
    }
  }

  private func expand(_ app: XCUIApplication) {
    let handle = app.buttons["map.panel.handle"]
    for _ in 0..<3 {
      if handle.value as? String == "Expanded" { return }
      handle.tap()
    }
  }

  private func fill(_ field: XCUIElement, _ text: String) {
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    if let value = field.value as? String, !value.isEmpty, value != field.placeholderValue {
      field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
    }
    field.typeText(text)
  }

  private func waitLabel(_ element: XCUIElement, _ text: String) {
    let expectation = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "label == %@", text), object: element)
    XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed)
  }

  private func waitEnabled(_ element: XCUIElement) {
    let expectation = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "enabled == true"), object: element)
    XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed)
  }

  private func attach(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func fixtureAccount(key: String = "lycoris.i4.synthetic-account") -> Fixture {
    let variable =
      key == "lycoris.i4.second-account"
      ? "LYCORIS_I4_SECOND_FIXTURE_JSON" : "LYCORIS_I4_FIXTURE_JSON"
    if let raw = ProcessInfo.processInfo.environment[variable],
      let fixture = try? JSONDecoder().decode(Fixture.self, from: Data(raw.utf8))
    {
      return fixture
    }
    if let data = UserDefaults.standard.data(forKey: key),
      let fixture = try? JSONDecoder().decode(Fixture.self, from: data)
    {
      return fixture
    }
    let suffix = UUID().uuidString.lowercased().prefix(8)
    let fixture = Fixture(
      username: "ios_i4_\(suffix)", email: "ios-i4-\(suffix)@example.invalid",
      password: "I4-\(UUID().uuidString)")
    UserDefaults.standard.set(try? JSONEncoder().encode(fixture), forKey: key)
    return fixture
  }

  private func requireSyntheticStack() async throws {
    let (data, response) = try await URLSession.shared.data(
      from: base.appendingPathComponent("api/markers/1"))
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      String(decoding: data, as: UTF8.self).contains("S1 Synthetic Shanghai Center")
    else {
      throw XCTSkip("The loopback synthetic fixture stack is required")
    }
  }

  private func request(_ session: URLSession, _ path: String, fields: [String: String]) async throws
    -> (Data, Int)
  {
    var request = URLRequest(url: base.appendingPathComponent(path))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(fields)
    let (data, response) = try await session.data(for: request)
    return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
  }
}
