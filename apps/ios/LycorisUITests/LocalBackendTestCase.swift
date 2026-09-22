import XCTest

/// Fixture preflights and the UI must address the same local backend.
/// Reject an accidental `test -configuration Debug` after normal runs moved to HTTPS.
@MainActor
class LocalBackendTestCase: XCTestCase {
  private enum SystemPromptError: Error { case passwordSaveDidNotDismiss }

  override func setUpWithError() throws {
    #if !LYCORIS_LOCAL_TESTS
      throw XCTSkip("Use the Test build configuration for local fixture UI tests.")
    #endif
  }

  func dismissPasswordSaveAlert(
    in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
  ) throws {
    let declineLabel = NSPredicate(format: "label IN %@", ["Not Now", "以后", "以后再说"])
    let hosts = [app, XCUIApplication(bundleIdentifier: "com.apple.springboard")]
    let candidates = hosts.map { host in
      // Password AutoFill is an Alert on iPad and can be a remote Sheet on iPhone.
      host.descendants(matching: .any).matching(
        NSPredicate(format: "elementType IN %@", [
          XCUIElement.ElementType.alert.rawValue, XCUIElement.ElementType.sheet.rawValue,
        ])
      ).containing(declineLabel).firstMatch
    }
    var presentedIndex: Int?
    let appeared = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in
        presentedIndex = candidates.firstIndex { $0.exists }
        return presentedIndex != nil
      }, object: nil)
    // Check both hosts throughout the same interval. A delayed app-owned prompt
    // must not be missed while the test waits only on SpringBoard.
    guard XCTWaiter.wait(for: [appeared], timeout: 10) == .completed,
      let presentedIndex
    else { return }
    let candidate = candidates[presentedIndex]
    // Keep the container query independent of its button during dismissal.
    let prompt = hosts[presentedIndex].descendants(matching: candidate.elementType)
      .matching(NSPredicate(format: "label == %@", candidate.label)).firstMatch
    let notNow = prompt.buttons.matching(declineLabel).firstMatch
    // iOS can expose the button before the system prompt finishes presenting.
    // Never continue into the underlying editor while this modal covers it.
    for _ in 0..<3 {
      notNow.tap()
      if prompt.waitForNonExistence(timeout: 2) { return }
    }
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "password-save-alert-did-not-dismiss"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    XCTFail("Save Password alert did not dismiss", file: file, line: line)
    throw SystemPromptError.passwordSaveDidNotDismiss
  }
}
