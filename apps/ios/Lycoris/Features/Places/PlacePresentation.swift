import Foundation

struct PlacePresentation: Identifiable, Equatable, Sendable {
  let id: String
  let title: String
  let detailTitle: String
  let distance: String
  let openingHours: String
  let description: String
  let photoAsset: String?
  let latitude: Double
  let longitude: Double
  var category: PlaceCategory = .toilet
  var imageURL: URL? = nil
  var distanceReference: String? = nil

  var point: GeoPoint? { GeoPoint(latitude: latitude, longitude: longitude) }
  var hasPhoto: Bool { photoAsset != nil || imageURL != nil }

  init(marker: Marker, origin: GeoPoint?, located: Bool, baseURL: URL?) {
    id = String(marker.id)
    title = marker.title
    detailTitle = marker.title
    category = marker.category
    latitude = marker.lat
    longitude = marker.lng
    description = marker.description ?? ""
    photoAsset = nil
    imageURL = Self.imageURL(marker.markImage, baseURL: baseURL)
    openingHours = Self.hours(start: marker.openTimeStart, end: marker.openTimeEnd)
    if let origin, let point = marker.point {
      let meters = origin.distance(to: point)
      distance =
        meters < 1000 ? "\(Int(meters.rounded()))m" : String(format: "%.1fkm", meters / 1000)
      distanceReference =
        located
        ? String(localized: "Straight-line distance from your location")
        : String(localized: "Straight-line distance from map center")
    } else {
      distance = ""
      distanceReference = nil
    }
  }

  // Explicit design-only values, also used by SwiftUI previews.
  init(
    id: String, title: String, detailTitle: String, distance: String, openingHours: String,
    description: String, photoAsset: String, latitude: Double, longitude: Double
  ) {
    self.id = id
    self.title = title
    self.detailTitle = detailTitle
    self.distance = distance
    self.openingHours = openingHours
    self.description = description
    self.photoAsset = photoAsset
    self.latitude = latitude
    self.longitude = longitude
  }

  static func hours(start: String?, end: String?) -> String {
    func valid(_ time: String) -> Bool {
      time.range(of: #"^(?:[01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil
    }
    guard let start, let end, valid(start), valid(end) else {
      return String(localized: "Hours not provided")
    }
    return start == end ? String(localized: "Open 24 hours") : "\(start)–\(end)"
  }

  static func imageURL(_ path: String?, baseURL: URL?) -> URL? {
    guard let path, let baseURL,
      path.range(of: #"^/uploads/markers/[A-Za-z0-9_.-]+$"#, options: .regularExpression) != nil,
      ![".", ".."].contains(String(path.split(separator: "/").last ?? ""))
    else { return nil }
    return URL(string: path, relativeTo: baseURL)?.absoluteURL
  }

  /// Public destination only. No location origin or guessed Lycoris domain.
  var shareURL: URL? {
    guard point != nil else { return nil }
    var url = URLComponents(string: "https://maps.apple.com/")!
    url.queryItems = [
      URLQueryItem(name: "ll", value: "\(latitude),\(longitude)"),
      URLQueryItem(name: "q", value: title),
    ]
    return url.url
  }
}
