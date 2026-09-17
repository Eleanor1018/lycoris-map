import XCTest

/// Fixture preflights and the UI must address the same local backend.
/// Reject an accidental `test -configuration Debug` after normal runs moved to HTTPS.
@MainActor
class LocalBackendTestCase: XCTestCase {
  override func setUpWithError() throws {
    #if !LYCORIS_LOCAL_TESTS
      throw XCTSkip("Use the Test build configuration for local fixture UI tests.")
    #endif
  }
}
