import Foundation
import Testing

@testable import Lycoris

struct AccountHTTPTests {
  private func api(_ host: String) -> AccountAPI {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [AccountStubProtocol.self]
    return AccountAPI(
      baseURL: URL(string: "https://\(host).example.test"),
      session: URLSession(configuration: configuration))
  }

  @Test func envelopeAndNullOptionalFieldsDecodeWithoutInventingIdentity() async throws {
    let user = try await api("valid").user()
    #expect(user.publicId == "fixture-id" && user.pronouns == nil)
    await #expect(throws: AccountFailure(status: 502)) { try await api("invalid").user() }
  }

  @Test func httpStatusPrecedesBodyAndRetainsCorrelation() async {
    await #expect(throws: AccountFailure(status: 401, code: 4001, requestID: "account-test")) {
      try await api("unauthorized").user()
    }
    await #expect(throws: AccountFailure(status: 503, requestID: "account-test")) {
      try await api("offline").user()
    }
  }

  @Test func accountSessionUsesPersistentCookiesButNoPrivateCache() {
    let config = AccountAPI().session.configuration
    #expect(config.httpShouldSetCookies)
    #expect(config.httpCookieStorage != nil)
    #expect(config.urlCache == nil && config.urlCredentialStorage == nil)
    let publicConfig = MarkerAPI().session.configuration
    #expect(!publicConfig.httpShouldSetCookies && publicConfig.httpCookieStorage == nil)
  }

  @Test func privateMarkerFlagsSurviveDecodingAndFavoriteMayHaveEmptyBody() async throws {
    let values = try await api("markers").places("api/markers/me/created", language: "en")
    #expect(values.first?.isPublic == false && values.first?.reviewStatus == "PENDING")
    #expect(
      try await api("empty").send(AccountRequest(path: "api/markers/1/favorite", method: "POST"))
        .isEmpty)
  }
}

private final class AccountStubProtocol: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let url = request.url!
    let status: Int
    let body: String
    switch url.host?.split(separator: ".").first {
    case "unauthorized":
      status = 401
      body = #"{"code":4001,"data":null}"#
    case "offline":
      status = 503
      body = "Dependency unavailable"
    case "invalid":
      status = 200
      body = #"{"code":0,"data":null}"#
    case "empty":
      status = 200
      body = ""
    case "markers":
      status = 200
      body =
        #"[{"id":1,"version":1,"lat":31,"lng":121,"category":"accessible_toilet","title":"Owned","contentLanguage":"en","isPublic":false,"reviewStatus":"PENDING"}]"#
    default:
      status = 200
      body = #"{"code":0,"data":{"publicId":"fixture-id","username":"Fixture","pronouns":null}}"#
    }
    client?.urlProtocol(
      self,
      didReceive: HTTPURLResponse(
        url: url, statusCode: status, httpVersion: "HTTP/1.1",
        headerFields: ["X-Request-ID": "account-test"])!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
