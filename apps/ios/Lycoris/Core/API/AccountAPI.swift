import Foundation

struct AccountUser: Codable, Equatable, Sendable {
  let publicId: String
  var username: String?
  var nickname: String?
  var email: String?
  var avatarUrl: String?
  var pronouns: String?
  var signature: String?

  var displayName: String { nickname ?? username ?? String(localized: "Account") }
  var initials: String {
    let words = displayName.split(whereSeparator: \.isWhitespace)
    return String(words.prefix(2).compactMap(\.first)).uppercased()
  }
}

struct AccountFailure: Error, Equatable, Sendable {
  let status: Int
  var code: Int? = nil
  var requestID: String? = nil

  var message: String {
    switch status {
    case 0: String(localized: "Could not reach the service. Please try again.")
    case 401: String(localized: "Please log in again.")
    case 404: String(localized: "This item is no longer available.")
    case 409: String(localized: "Your account changed. Reload it before trying again.")
    case 413: String(localized: "Choose a smaller photo.")
    case 429: String(localized: "Too many attempts. Please try again later.")
    case 400: String(localized: "Check your details and try again.")
    case -1: String(localized: "The account service is not configured yet.")
    default: String(localized: "The service is unavailable. Please try again.")
    }
  }
}

struct AccountRequest: Sendable {
  let path: String
  var method = "GET"
  var body: Data? = nil
  var contentType = "application/json"
  var query: [String: String] = [:]

  static func json(_ path: String, method: String = "POST", fields: [String: String]) throws -> Self
  {
    Self(path: path, method: method, body: try JSONEncoder().encode(fields))
  }
}

protocol AccountServing: Sendable {
  var baseURL: URL? { get }
  func send(_ request: AccountRequest) async throws -> Data
}

/// Only this session carries account cookies. Private responses never enter a URL cache.
struct AccountAPI: AccountServing {
  let baseURL: URL?
  let session: URLSession

  init(baseURL: URL? = (try? AppConfiguration.bundled())?.apiBaseURL, session: URLSession? = nil) {
    self.baseURL = baseURL
    let configuration = URLSessionConfiguration.default
    configuration.httpCookieStorage = .shared
    configuration.httpShouldSetCookies = true
    configuration.urlCredentialStorage = nil
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.timeoutIntervalForRequest = 20
    self.session = session ?? URLSession(configuration: configuration)
  }

  func send(_ input: AccountRequest) async throws -> Data {
    guard let baseURL else { throw AccountFailure(status: -1) }
    guard !input.path.contains(".."), !input.path.contains(":") else {
      throw AccountFailure(status: 400)
    }
    var url = URLComponents(
      url: baseURL.appendingPathComponent(input.path), resolvingAgainstBaseURL: false)!
    if !input.query.isEmpty {
      url.queryItems = input.query.sorted { $0.key < $1.key }.map {
        URLQueryItem(name: $0.key, value: $0.value)
      }
    }
    var request = URLRequest(url: url.url!)
    request.httpMethod = input.method
    request.httpBody = input.body
    request.setValue(input.contentType, forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    let (data, response) = try await session.data(for: request)
    guard let response = response as? HTTPURLResponse else { throw AccountFailure(status: 0) }
    guard (200..<300).contains(response.statusCode) else {
      throw AccountFailure(
        status: response.statusCode,
        code: (try? JSONDecoder().decode(ServiceCode.self, from: data))?.code,
        requestID: response.value(forHTTPHeaderField: "X-Request-ID"))
    }
    return data
  }
}

private struct ServiceCode: Decodable { let code: Int }
private struct AccountEnvelope: Decodable {
  let code: Int
  let data: AccountUser?
}

extension AccountServing {
  func user(_ request: AccountRequest = AccountRequest(path: "api/me")) async throws -> AccountUser
  {
    let data = try await send(request)
    guard let envelope = try? JSONDecoder().decode(AccountEnvelope.self, from: data),
      envelope.code == 0, let user = envelope.data, !user.publicId.isEmpty
    else { throw AccountFailure(status: 502) }
    return user
  }

  func places(_ path: String, language: String) async throws -> [Marker] {
    let data = try await send(AccountRequest(path: path, query: ["lang": language]))
    guard let markers = try? JSONDecoder().decode([Marker].self, from: data),
      markers.allSatisfy({ $0.id > 0 && $0.point != nil })
    else { throw AccountFailure(status: 502) }
    var seen = Set<Int64>()
    return markers.filter { seen.insert($0.id).inserted }
  }
}

enum AccountValidation {
  static func password(_ value: String) -> Bool { value.utf16.count >= 4 && value.utf8.count <= 72 }
  static func profile(nickname: String, pronouns: String, signature: String) -> Bool {
    nickname.unicodeScalars.count <= 255 && pronouns.unicodeScalars.count <= 64
      && signature.unicodeScalars.count <= 200
  }
}
