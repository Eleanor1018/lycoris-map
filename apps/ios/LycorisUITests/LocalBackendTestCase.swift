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
    for host in [app, XCUIApplication(bundleIdentifier: "com.apple.springboard")] {
      // Password AutoFill is an Alert on iPad and can be a remote Sheet on iPhone.
      let prompt = host.descendants(matching: .any).matching(
        NSPredicate(format: "elementType IN %@", [
          XCUIElement.ElementType.alert.rawValue, XCUIElement.ElementType.sheet.rawValue,
        ])
      ).containing(declineLabel).firstMatch
      let notNow = prompt.buttons.matching(declineLabel).firstMatch
      if notNow.waitForExistence(timeout: 3) {
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
  }
}
