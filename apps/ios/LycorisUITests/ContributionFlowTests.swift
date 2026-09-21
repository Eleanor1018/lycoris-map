import XCTest

@MainActor final class ContributionFlowTests: LocalBackendTestCase {
  private let base = URL(string: "http://127.0.0.1:8080")!
  private struct Fixture: Codable {
    let username: String
    let password: String
  }
  override func setUp() { continueAfterFailure = false }

  func testNativeCreatePhotoDraftRelaunchAndEditProposal() async throws {
    let (fixture, session) = try await fixtureSession()
    let app = launch()
    app.buttons["map.account"].tap()
    logoutIfNeeded(app)
    app.buttons["account.close"].tap()
    app.buttons["map.contribute"].tap()
    guard app.textFields["auth.username"].waitForExistence(timeout: 8) else {
      attach(app, "i5-entry-failure")
      XCTFail("Contribution must request login: \(app.debugDescription)")
      return
    }
    fill(app.textFields["auth.username"], fixture.username)
    fill(app.secureTextFields["auth.password"], fixture.password)
    app.secureTextFields["auth.password"].typeText("\n")
    declinePasswordSave(app)
    let useLocation = app.buttons["contribution.confirm-location"]
    let chooseLocation = app.buttons["contribution.location"]
    let defaultPoint = try await enterMapLocationSelection(app)
    let first = app.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.35))
    let second = app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.5))
    first.press(forDuration: 0.05, thenDragTo: second)
    XCTAssertEqual(
      useLocation.value as? String, defaultPoint ?? "",
      "Panning must preserve the GPS pin or leave an unselected map empty")
    XCTAssertEqual(useLocation.isEnabled, defaultPoint != nil)
    first.tap()
    await assertReady(useLocation)
    let initialPoint = try XCTUnwrap(useLocation.value as? String)
    first.press(forDuration: 0.05, thenDragTo: second)
    XCTAssertEqual(useLocation.value as? String, initialPoint, "Pan must preserve the pin")
    second.doubleTap()
    XCTAssertEqual(useLocation.value as? String, initialPoint, "Double tap only zooms")
    app.maps.firstMatch.pinch(withScale: 1.5, velocity: 1)
    XCTAssertEqual(useLocation.value as? String, initialPoint, "Pinch only zooms")
    second.tap()
    await assertCoordinateChanges(useLocation, from: initialPoint)
    attach(app, "i5-map-selection")
    // Cancel preserves a GPS-created draft, or leaves no draft when the GPS
    // request failed and the user has not confirmed a manual location yet.
    app.buttons["contribution.cancel-location"].tap()
    if let defaultPoint {
      XCTAssertTrue(chooseLocation.waitForExistence(timeout: 5))
      XCTAssertEqual(chooseLocation.value as? String, defaultPoint)
      XCTAssertTrue(app.textFields["contribution.title"].exists)
      app.buttons["contribution.close"].tap()
    } else {
      XCTAssertFalse(app.textFields["contribution.title"].exists)
    }
    await assertReady(app.buttons["map.contribute"])
    app.buttons["map.contribute"].tap()
    let reopenedDefault = try await enterMapLocationSelection(app)
    if let defaultPoint {
      XCTAssertEqual(reopenedDefault, defaultPoint, "Reopening must preserve the saved GPS draft")
    }
    first.tap()
    await assertReady(useLocation)
    let confirmedPoint = try XCTUnwrap(useLocation.value as? String)
    useLocation.tap()
    guard app.textFields["contribution.title"].waitForExistence(timeout: 5) else {
      XCTFail("Native contribution form missing")
      return
    }
    let title = "I5 Native \(UUID().uuidString.prefix(8))"
    fill(app.textFields["contribution.title"], title)
    app.textFields["contribution.title"].typeText("\n")
    XCTAssertEqual(chooseLocation.value as? String, confirmedPoint)
    chooseLocation.tap()
    await assertReady(useLocation)
    XCTAssertEqual(useLocation.value as? String, confirmedPoint)
    second.tap()
    await assertCoordinateChanges(useLocation, from: confirmedPoint)
    app.buttons["contribution.cancel-location"].tap()
    XCTAssertTrue(chooseLocation.waitForExistence(timeout: 5))
    XCTAssertEqual(
      chooseLocation.value as? String, confirmedPoint, "Cancel preserves saved location")
    XCTAssertEqual(app.textFields["contribution.title"].value as? String, title)
    chooseLocation.tap()
    await assertReady(useLocation)
    second.tap()
    await assertCoordinateChanges(useLocation, from: confirmedPoint)
    let updatedPoint = try XCTUnwrap(useLocation.value as? String)
    useLocation.tap()
    XCTAssertTrue(chooseLocation.waitForExistence(timeout: 5))
    XCTAssertEqual(chooseLocation.value as? String, updatedPoint)
    XCTAssertEqual(app.textFields["contribution.title"].value as? String, title)
    let picker = app.buttons["contribution.photo"]
    for _ in 0..<6 {
      if picker.isHittable { break }
      app.swipeUp()
    }
    guard await ready(picker) else {
      attach(app, "i5-photo-entry-failure")
      XCTFail("Photo picker missing: \(app.debugDescription)")
      return
    }
    picker.tap()
    let photo = app.images.matching(
      NSPredicate(
        format: "label BEGINSWITH 'Photo,' OR label BEGINSWITH '照片，' OR label BEGINSWITH '照片,'")
    ).firstMatch
    guard photo.waitForExistence(timeout: 8) else {
      XCTFail("Synthetic simulator photo missing")
      return
    }
    attach(app, "i5-system-photo-picker")
    photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    guard app.images["Selected photo"].waitForExistence(timeout: 8) else {
      XCTFail("Selected photo must be persisted")
      return
    }
    attach(app, "i5-native-contribution-photo")
    app.terminate()
    app.launch()
    guard await ready(app.buttons["map.contribute"]) else {
      XCTFail("Map did not return")
      return
    }
    // Wait for restored identity through the account entry, then reopen saved work.
    app.buttons["map.account"].tap()
    guard app.buttons["profile.avatar"].waitForExistence(timeout: 10) else {
      XCTFail("Session not restored")
      return
    }
    app.buttons["account.close"].tap()
    app.buttons["map.contribute"].tap()
    guard app.textFields["contribution.title"].waitForExistence(timeout: 5) else {
      XCTFail("Draft not restored")
      return
    }
    XCTAssertEqual(app.textFields["contribution.title"].value as? String, title)
    XCTAssertEqual(chooseLocation.value as? String, updatedPoint)
    let submit = app.buttons["contribution.submit"]
    guard await ready(submit) else {
      XCTFail("Restored draft cannot submit")
      return
    }
    attach(app, "i5-restored-draft")
    submit.tap()
    guard app.staticTexts["contribution.complete"].waitForExistence(timeout: 20) else {
      XCTFail("Marker and photo must submit for review")
      return
    }
    attach(app, "i5-awaiting-review")
    let own = try await created(session)
    let matches = own.filter { $0["title"] as? String == title }
    XCTAssertEqual(matches.count, 1)
    let marker = try XCTUnwrap(matches.first)
    let id = try XCTUnwrap(marker["id"] as? Int64)
    XCTAssertEqual(marker["reviewStatus"] as? String, "PENDING")
    XCTAssertNil(marker["markImage"] as? String, "Photo is a proposal, not an approved image")
    app.buttons["contribution.close"].tap()
    app.buttons["map.account"].tap()
    app.buttons["My Places"].tap()
    let row = app.buttons["place.row.\(id)"]
    guard await ready(row) else {
      XCTFail("Created pending place missing from own list")
      return
    }
    row.tap()
    guard await ready(app.buttons["place.edit"]) else {
      XCTFail("Edit entry missing")
      return
    }
    app.buttons["place.edit"].tap()
    guard app.textFields["contribution.title"].waitForExistence(timeout: 8) else {
      XCTFail("Editor missing")
      return
    }
    XCTAssertFalse(
      app.buttons["contribution.location"].exists, "Existing coordinates cannot be changed")
    fill(app.textFields["contribution.title"], title + " edited")
    attach(app, "i5-native-edit")
    app.buttons["contribution.submit"].tap()
    guard app.staticTexts["contribution.complete"].waitForExistence(timeout: 12) else {
      XCTFail("Edit proposal missing")
      return
    }
    let after = try await created(session).first { $0["id"] as? Int64 == id }
    XCTAssertEqual(
      after?["title"] as? String, title, "Unapproved edits must not change live details")
    app.buttons["contribution.close"].tap()
  }

  /// Wait for GPS to create a draft, or for an unavailable fix to fall back
  /// to explicit map selection. The waiting form also has a change-location
  /// button, so require the title field before treating it as a saved draft.
  private func enterMapLocationSelection(_ app: XCUIApplication) async throws -> String? {
    let chooseLocation = app.buttons["contribution.location"]
    let useLocation = app.buttons["contribution.confirm-location"]
    let title = app.textFields["contribution.title"]
    let resolved = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in
        useLocation.exists || (title.exists && chooseLocation.exists)
      }, object: app)
    guard await XCTWaiter.fulfillment(of: [resolved], timeout: 25) == .completed else {
      attach(app, "i5-contribution-location-entry-failure")
      XCTFail("Contribution must open a GPS draft or fall back to manual location selection")
      throw URLError(.timedOut)
    }
    if title.exists {
      let savedPoint = try XCTUnwrap(chooseLocation.value as? String)
      XCTAssertFalse(savedPoint.isEmpty, "A GPS-created draft must contain a real coordinate")
      await assertReady(chooseLocation)
      chooseLocation.tap()
      XCTAssertTrue(useLocation.waitForExistence(timeout: 5))
      XCTAssertTrue(useLocation.isEnabled)
      XCTAssertEqual(useLocation.value as? String, savedPoint)
      return savedPoint
    }
    XCTAssertFalse(useLocation.isEnabled, "The map center must not silently become the location")
    XCTAssertEqual(useLocation.value as? String, "")
    return nil
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
  private func ready(_ element: XCUIElement) async -> Bool {
    await XCTWaiter.fulfillment(
      of: [
        XCTNSPredicateExpectation(
          predicate: NSPredicate(format: "exists == true AND hittable == true AND enabled == true"),
          object: element)
      ], timeout: 10) == .completed
  }
  private func assertReady(_ element: XCUIElement) async {
    let isReady = await ready(element)
    XCTAssertTrue(isReady)
  }
  private func assertCoordinateChanges(_ element: XCUIElement, from previous: String) async {
    let result = await XCTWaiter.fulfillment(
      of: [
        XCTNSPredicateExpectation(
          predicate: NSPredicate(format: "value != %@", previous), object: element)
      ], timeout: 5)
    XCTAssertEqual(result, .completed)
  }
  private func fill(_ element: XCUIElement, _ value: String) {
    element.tap()
    if let old = element.value as? String, old != element.placeholderValue, !old.isEmpty {
      element.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count))
    }
    element.typeText(value)
  }
  private func logoutIfNeeded(_ app: XCUIApplication) {
    if app.buttons["profile.avatar"].waitForExistence(timeout: 3) {
      for _ in 0..<10 {
        if app.buttons["profile.logout"].isHittable { break }
        app.swipeUp()
      }
      app.buttons["profile.logout"].tap()
    }
    XCTAssertTrue(app.textFields["auth.username"].waitForExistence(timeout: 8))
  }
  private func declinePasswordSave(_ app: XCUIApplication) {
    for host in [app, XCUIApplication(bundleIdentifier: "com.apple.springboard")] {
      let button = host.buttons.matching(
        NSPredicate(format: "label IN %@", ["Not Now", "以后", "以后再说"])
      ).firstMatch
      if button.waitForExistence(timeout: 3) {
        for _ in 0..<3 {
          button.tap()
          if button.waitForNonExistence(timeout: 2) { break }
        }
        return
      }
    }
  }
  private func attach(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
  private func fixtureSession() async throws -> (Fixture, URLSession) {
    let (bytes, response) = try await URLSession.shared.data(
      from: base.appendingPathComponent("api/markers/1"))
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      String(decoding: bytes, as: UTF8.self).contains("S1 Synthetic Shanghai Center")
    else {
      throw XCTSkip("Requires loopback synthetic Rust stack")
    }
    let key = "lycoris.i5.synthetic-account"
    let fixture: Fixture
    if let bytes = UserDefaults.standard.data(forKey: key),
      let saved = try? JSONDecoder().decode(Fixture.self, from: bytes)
    {
      fixture = saved
    } else {
      fixture = Fixture(
        username: "ios_i5_\(UUID().uuidString.prefix(8))", password: "I5-\(UUID().uuidString)")
      UserDefaults.standard.set(try JSONEncoder().encode(fixture), forKey: key)
    }
    let session = URLSession(configuration: .ephemeral)
    func authenticate(_ registering: Bool) async throws -> Int {
      var request = URLRequest(
        url: base.appendingPathComponent(registering ? "api/register" : "api/login"))
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      var fields = ["username": fixture.username, "password": fixture.password]
      if registering { fields["email"] = "\(fixture.username)@example.invalid" }
      request.httpBody = try JSONEncoder().encode(fields)
      let (_, response) = try await session.data(for: request)
      return (response as? HTTPURLResponse)?.statusCode ?? 0
    }
    let login = try await authenticate(false)
    let status = login == 401 ? try await authenticate(true) : login
    guard status == 200 else {
      XCTFail("Synthetic account unavailable")
      throw URLError(.userAuthenticationRequired)
    }
    return (fixture, session)
  }
  private func created(_ session: URLSession) async throws -> [[String: Any]] {
    let url = URL(string: "api/markers/me/created?lang=en", relativeTo: base)!.absoluteURL
    let (data, response) = try await session.data(from: url)
    XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
  }
}
