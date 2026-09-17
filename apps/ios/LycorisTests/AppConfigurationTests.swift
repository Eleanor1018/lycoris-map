import Testing

@testable import Lycoris

struct AppConfigurationTests {
  @Test func bundledConfigurationUsesTheSelectedEnvironment() throws {
    #if LYCORIS_LOCAL_TESTS
      #expect(try AppConfiguration.bundled().apiBaseURL?.absoluteString == "http://127.0.0.1:8080")
    #else
      #expect(
        try AppConfiguration.bundled().apiBaseURL?.absoluteString == "https://api.lycoris-map.com")
    #endif
  }

  @Test func missingAddressIsNotReplacedWithDevelopmentHost() throws {
    let configuration = try AppConfiguration(serviceURL: "", allowsHTTP: false)
    #expect(configuration.apiBaseURL == nil)
  }

  @Test func releaseRejectsHTTP() {
    #expect(throws: AppConfiguration.ConfigurationError.insecureReleaseURL) {
      try AppConfiguration(serviceURL: "http://127.0.0.1:8080", allowsHTTP: false)
    }
  }

  @Test(arguments: [
    "/api", "file:///private/tmp", "https://user:secret@example.com",
    "https://example.com?token=secret",
  ])
  func rejectsMalformedOrCredentialBearingAddresses(address: String) {
    #expect(throws: AppConfiguration.ConfigurationError.invalidServiceURL) {
      try AppConfiguration(serviceURL: address, allowsHTTP: true)
    }
  }

  @Test func simulatorCanUseLocalService() throws {
    let configuration = try AppConfiguration(serviceURL: "http://127.0.0.1:8080", allowsHTTP: true)
    #expect(configuration.apiBaseURL?.host == "127.0.0.1")
  }
}
