import Foundation

struct AppConfiguration: Sendable {
  enum ConfigurationError: Error, Equatable {
    case invalidServiceURL
    case insecureReleaseURL
  }

  let apiBaseURL: URL?

  init(serviceURL: String, allowsHTTP: Bool) throws {
    guard !serviceURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      apiBaseURL = nil
      return
    }
    guard let url = URL(string: serviceURL),
      let scheme = url.scheme, ["https", "http"].contains(scheme),
      let host = url.host, !host.isEmpty,
      url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil
    else { throw ConfigurationError.invalidServiceURL }
    guard allowsHTTP || scheme == "https" else {
      throw ConfigurationError.insecureReleaseURL
    }
    apiBaseURL = url
  }

  static func bundled(in bundle: Bundle = .main) throws -> Self {
    #if DEBUG
      let allowsHTTP = true
    #else
      let allowsHTTP = false
    #endif
    return try Self(
      serviceURL: bundle.object(forInfoDictionaryKey: "LycorisAPIBaseURL") as? String ?? "",
      allowsHTTP: allowsHTTP
    )
  }
}
