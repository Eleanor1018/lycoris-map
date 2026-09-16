import Foundation

/// Public read DTO. Rust identifiers stay Int64 all the way to the URL.
struct Marker: Decodable, Equatable, Sendable {
  let id: Int64
  let version: Int64
  let lat: Double
  let lng: Double
  let category: PlaceCategory
  let title: String
  let description: String?
  let openTimeStart: String?
  let openTimeEnd: String?
  let markImage: String?
  let contentLanguage: String

  var point: GeoPoint? { GeoPoint(latitude: lat, longitude: lng) }
}

enum PlaceCategory: String, Decodable, CaseIterable, Sendable {
  case toilet = "accessible_toilet"
  case nursing = "baby_room"
  case medical = "friendly_clinic"
  case other = "self_definition"

  var title: String {
    switch self {
    case .toilet: String(localized: "Accessible Toilets")
    case .nursing: String(localized: "Nursing Rooms")
    case .medical: String(localized: "Medical Institutions")
    case .other: String(localized: "Places")
    }
  }
  var image: String {
    switch self {
    case .toilet: "Toilet"
    case .nursing: "Nursing"
    case .medical: "Medical"
    case .other: "PlacePin"
    }
  }
  var tint: String {
    switch self {
    case .toilet, .other: "ToiletTint"
    case .nursing: "NursingTint"
    case .medical: "MedicalTint"
    }
  }
}

struct MarkerBounds: Equatable, Sendable {
  let south: Double
  let west: Double
  let north: Double
  let east: Double
}

enum MarkerQuery: Equatable, Sendable {
  case viewport(MarkerBounds)
  case search(String)
  case nearby(GeoPoint, PlaceCategory)
}

enum PlaceFailure: Error, Equatable {
  case unconfigured, unavailable, invalidResponse, requestFailed

  var message: String {
    switch self {
    case .unconfigured: String(localized: "The map service is not configured yet.")
    case .unavailable: String(localized: "This place is no longer available.")
    case .invalidResponse, .requestFailed:
      String(localized: "Could not load places. Please try again.")
    }
  }
}

/// Keeps server correlation metadata for diagnostics without displaying server bodies.
struct MarkerRequestFailure: Error, Equatable, Sendable {
  let failure: PlaceFailure
  let status: Int
  let requestID: String?
}

protocol MarkerServing: Sendable {
  var baseURL: URL? { get }
  func markers(_ query: MarkerQuery, language: String) async throws -> [Marker]
  func detail(id: Int64, language: String) async throws -> Marker
}

struct MarkerAPI: MarkerServing {
  let baseURL: URL?
  let session: URLSession

  init(
    baseURL: URL? = (try? AppConfiguration.bundled())?.apiBaseURL,
    session: URLSession? = nil
  ) {
    self.baseURL = baseURL
    if let session {
      self.session = session
    } else {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.httpShouldSetCookies = false
      configuration.httpCookieStorage = nil
      configuration.urlCredentialStorage = nil
      configuration.timeoutIntervalForRequest = 15
      self.session = URLSession(configuration: configuration)
    }
  }

  func markers(_ query: MarkerQuery, language: String) async throws -> [Marker] {
    let request = try request(for: query, language: language)
    let markers: [Marker] = try await read(request)
    guard markers.allSatisfy({ $0.id > 0 && $0.point != nil }) else {
      throw PlaceFailure.invalidResponse
    }
    // No pagination wrapper is used by these endpoints.
    var seen = Set<Int64>()
    return markers.filter { seen.insert($0.id).inserted }
  }

  func detail(id: Int64, language: String) async throws -> Marker {
    guard id > 0 else { throw PlaceFailure.unavailable }
    let marker: Marker = try await read(makeRequest(path: "\(id)", query: ["lang": language]))
    guard marker.id == id, marker.point != nil else { throw PlaceFailure.invalidResponse }
    return marker
  }

  func request(for query: MarkerQuery, language: String) throws -> URLRequest {
    var params = ["lang": language]
    let path: String
    switch query {
    case .viewport(let bounds):
      path = "viewport"
      params.merge([
        "minLat": String(bounds.south), "minLng": String(bounds.west),
        "maxLat": String(bounds.north), "maxLng": String(bounds.east),
      ]) { _, new in new }
    case .search(let term):
      path = "search"
      params["q"] = term.trimmingCharacters(in: .whitespacesAndNewlines)
    case .nearby(let point, let category):
      path = "nearby"
      params.merge([
        "lat": String(point.latitude), "lng": String(point.longitude),
        "radius": "1000", "category": category.rawValue,
      ]) { _, new in new }
    }
    return try makeRequest(path: path, query: params)
  }

  private func makeRequest(path: String, query: [String: String]) throws -> URLRequest {
    guard let baseURL else { throw PlaceFailure.unconfigured }
    var components = URLComponents(
      url: baseURL.appendingPathComponent("api/markers/\(path)"), resolvingAgainstBaseURL: false)!
    components.queryItems = query.sorted { $0.key < $1.key }.map {
      URLQueryItem(name: $0.key, value: $0.value)
    }
    guard let url = components.url else { throw PlaceFailure.invalidResponse }
    var request = URLRequest(url: url)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    return request
  }

  private func read<Value: Decodable>(_ request: URLRequest) async throws -> Value {
    let (data, response) = try await session.data(for: request)
    try Task.checkCancellation()
    guard let response = response as? HTTPURLResponse else { throw PlaceFailure.invalidResponse }
    func failure(_ reason: PlaceFailure) -> MarkerRequestFailure {
      MarkerRequestFailure(
        failure: reason, status: response.statusCode,
        requestID: response.value(forHTTPHeaderField: "X-Request-ID"))
    }
    if response.statusCode == 404 { throw failure(.unavailable) }
    guard (200..<300).contains(response.statusCode) else { throw failure(.requestFailed) }
    do { return try JSONDecoder().decode(Value.self, from: data) } catch {
      throw failure(.invalidResponse)
    }
  }
}
