import Foundation
import Testing

@testable import Lycoris

struct MarkerHTTPTests {
  private func api(_ scenario: String) -> MarkerAPI {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MarkerStubProtocol.self]
    return MarkerAPI(
      baseURL: URL(string: "https://\(scenario).example.test"),
      session: URLSession(configuration: configuration))
  }

  @Test func empty404AndText503AreHandledBeforeJSONDecoding() async {
    await #expect(
      throws: MarkerRequestFailure(failure: .unavailable, status: 404, requestID: "fixture-request")
    ) {
      try await api("missing").detail(id: 1, language: "en")
    }
    await #expect(
      throws: MarkerRequestFailure(
        failure: .requestFailed, status: 503, requestID: "fixture-request")
    ) {
      try await api("offline").detail(id: 1, language: "en")
    }
  }

  @Test func malformedSuccessAndInvalidCoordinatesFailCleanly() async {
    await #expect(
      throws: MarkerRequestFailure(
        failure: .invalidResponse, status: 200, requestID: "fixture-request")
    ) {
      try await api("invalid").detail(id: 1, language: "en")
    }
    await #expect(throws: PlaceFailure.invalidResponse) {
      try await api("coordinates").markers(.search("query"), language: "en")
    }
  }

  @MainActor @Test func publicImagesDecodeAndFailuresStaySeparateFromDetails() async throws {
    let client = api("image")
    let image = try await PlaceImageLoader.load(
      URL(string: "https://image.example.test/photo.png")!, session: client.session)
    #expect(image.size.width == 1 && image.size.height == 1)
    await #expect(throws: PlaceFailure.invalidResponse) {
      try await PlaceImageLoader.load(
        URL(string: "https://missing.example.test/photo.png")!, session: client.session)
    }
    await #expect(throws: PlaceFailure.invalidResponse) {
      try await PlaceImageLoader.load(
        URL(string: "https://invalid.example.test/photo.png")!, session: client.session)
    }
  }

  @Test func detailRejectsMismatchedID() async {
    await #expect(throws: PlaceFailure.invalidResponse) {
      try await api("wrongid").detail(id: 2, language: "en")
    }
  }
}

private final class MarkerStubProtocol: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let url = request.url!
    let status: Int
    let body: String
    switch url.host?.split(separator: ".").first {
    case "missing":
      status = 404
      body = ""
    case "offline":
      status = 503
      body = "Database unavailable"
    case "coordinates":
      status = 200
      body =
        #"[{"id":1,"version":1,"lat":91,"lng":121,"category":"accessible_toilet","title":"Invalid","contentLanguage":"en"}]"#
    case "wrongid":
      status = 200
      body =
        #"{"id":1,"version":1,"lat":31,"lng":121,"category":"accessible_toilet","title":"Wrong ID","contentLanguage":"en"}"#
    default:
      status = 200
      body = "not JSON"
    }
    client?.urlProtocol(
      self,
      didReceive: HTTPURLResponse(
        url: url, statusCode: status, httpVersion: "HTTP/1.1",
        headerFields: ["X-Request-ID": "fixture-request"])!,
      cacheStoragePolicy: .notAllowed)
    let data =
      url.host == "image.example.test"
      ? Data(
        base64Encoded:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII="
      )!
      : Data(body.utf8)
    client?.urlProtocol(self, didLoad: data)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
