import CoreLocation
import Foundation

/// Only the MapKit boundary uses this space. GeoPoint, storage and API values stay WGS84.
/// A provider is calibrated before accepting map-picked coordinates in mainland China.
enum MapCoordinateSpace: Equatable, Sendable {
  case unresolved, wgs84, gcj02

  func coordinate(for point: GeoPoint) -> CLLocationCoordinate2D? {
    if MainlandCoverage.mayContain(point), !MainlandCoverage.isAvailable { return nil }
    guard MainlandCoverage.contains(point) else { return point.coordinate }
    switch self {
    case .unresolved: return nil
    case .wgs84: return point.coordinate
    case .gcj02: return GCJ02.forward(point).coordinate
    }
  }

  func point(from coordinate: CLLocationCoordinate2D) -> GeoPoint? {
    guard let raw = GeoPoint(latitude: coordinate.latitude, longitude: coordinate.longitude)
    else { return nil }
    if self == .wgs84 { return raw }
    // At a coastline/border the piecewise transform can overlap itself. Reject
    // ambiguous picks instead of saving an offshore point hundreds of metres inland.
    guard MainlandCoverage.mayContain(raw) else { return raw }
    guard MainlandCoverage.isAvailable else { return nil }
    let candidate = GCJ02.inverse(raw)
    let rawInside = MainlandCoverage.contains(raw)
    let candidateInside = MainlandCoverage.contains(candidate)
    guard rawInside == candidateInside else { return nil }
    if candidateInside {
      return self == .gcj02 ? candidate : nil
    }
    return raw
  }
}

/// Public-domain Natural Earth mainland geometry; see MapCoordinates-LICENSE.txt.
/// This is a conversion coverage mask, not a statement about political boundaries.
enum MainlandCoverage {
  private struct Geometry: Decodable { let coordinates: [[[[Double]]]] }
  private struct Edge {
    let x: Double
    let y: Double
    let nextX: Double
    let nextY: Double
  }
  private static let strips: [Int: [Edge]] = {
    guard let url = Bundle.main.url(forResource: "MainlandCoverage", withExtension: "json"),
      let data = try? Data(contentsOf: url),
      let geometry = try? JSONDecoder().decode(Geometry.self, from: data)
    else { return [:] }
    // Index edges by latitude so rendering many pins doesn't walk 14,000 vertices per pin.
    var strips: [Int: [Edge]] = [:]
    for polygon in geometry.coordinates {
      for ring in polygon where ring.count >= 4 {
        for (a, b) in zip(ring, ring.dropFirst()) where a.count == 2 && b.count == 2 {
          guard a[1] != b[1] else { continue }
          let edge = Edge(x: a[0], y: a[1], nextX: b[0], nextY: b[1])
          for strip in Int(floor(min(a[1], b[1])))...Int(floor(max(a[1], b[1]))) {
            strips[strip, default: []].append(edge)
          }
        }
      }
    }
    return strips
  }()

  static func mayContain(_ point: GeoPoint) -> Bool {
    (18...54).contains(point.latitude) && (73...136).contains(point.longitude)
  }

  static var isAvailable: Bool { !strips.isEmpty }

  static func contains(_ point: GeoPoint) -> Bool {
    guard mayContain(point) else { return false }
    var result = false
    for edge in strips[Int(floor(point.latitude))] ?? [] {
      guard (edge.y > point.latitude) != (edge.nextY > point.latitude) else { continue }
      let crossing =
        (edge.nextX - edge.x) * (point.latitude - edge.y)
        / (edge.nextY - edge.y) + edge.x
      if point.longitude < crossing { result.toggle() }
    }
    return result
  }
}

/// Approximate GCJ transform adapted from MIT-licensed wandergis/coordtransform.
/// The iterative inverse eliminates its usual one-step round-trip error; it does
/// not claim survey-grade accuracy for the underlying regional approximation.
enum GCJ02 {
  static func forward(_ point: GeoPoint) -> GeoPoint {
    let x = point.longitude - 105
    let y = point.latitude - 35
    let wave = (20 * sin(6 * x * .pi) + 20 * sin(2 * x * .pi)) * 2 / 3
    var latitude = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * sqrt(abs(x))
    latitude += wave + (20 * sin(y * .pi) + 40 * sin(y / 3 * .pi)) * 2 / 3
    latitude += (160 * sin(y / 12 * .pi) + 320 * sin(y * .pi / 30)) * 2 / 3
    var longitude = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * sqrt(abs(x))
    longitude += wave + (20 * sin(x * .pi) + 40 * sin(x / 3 * .pi)) * 2 / 3
    longitude += (150 * sin(x / 12 * .pi) + 300 * sin(x / 30 * .pi)) * 2 / 3
    let radians = point.latitude / 180 * .pi
    let eccentricity = 0.00669342162296594323
    let magic = 1 - eccentricity * pow(sin(radians), 2)
    let root = sqrt(magic)
    latitude = latitude * 180 / (6_378_245 * (1 - eccentricity) / (magic * root) * .pi)
    longitude = longitude * 180 / (6_378_245 / root * cos(radians) * .pi)
    return GeoPoint(latitude: point.latitude + latitude, longitude: point.longitude + longitude)!
  }

  static func inverse(_ point: GeoPoint) -> GeoPoint {
    var candidate = point
    for _ in 0..<8 {
      let projected = forward(candidate)
      let latitudeError = projected.latitude - point.latitude
      let longitudeError = projected.longitude - point.longitude
      candidate = GeoPoint(
        latitude: candidate.latitude - latitudeError,
        longitude: candidate.longitude - longitudeError)!
      if max(abs(latitudeError), abs(longitudeError)) < 1e-9 { break }
    }
    return candidate
  }
}
