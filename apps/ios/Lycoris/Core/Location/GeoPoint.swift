import CoreLocation
import MapKit

/// Canonical WGS84 for API/database, Core Location and distance calculations.
/// MapKit display and picking pass through MapCoordinateSpace at the UI boundary.
struct GeoPoint: Codable, Equatable, Sendable {
  let latitude: Double
  let longitude: Double

  init?(latitude: Double, longitude: Double) {
    guard latitude.isFinite, longitude.isFinite,
      (-90...90).contains(latitude), (-180...180).contains(longitude)
    else { return nil }
    self.latitude = latitude
    self.longitude = longitude
  }

  var coordinate: CLLocationCoordinate2D {
    CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
  }

  func distance(to other: GeoPoint) -> Double {
    CLLocation(latitude: latitude, longitude: longitude).distance(
      from: CLLocation(latitude: other.latitude, longitude: other.longitude))
  }
}

struct MapViewport: Equatable, Sendable {
  let center: GeoPoint
  let bounds: [MarkerBounds]

  init?(
    rect: MKMapRect, center: CLLocationCoordinate2D,
    space: MapCoordinateSpace = .wgs84
  ) {
    guard let center = space.point(from: center),
      !rect.isNull, !rect.isEmpty, rect.size.width.isFinite, rect.size.height.isFinite
    else { return nil }
    self.center = center
    let north = min(90, MKMapPoint(x: 0, y: max(0, rect.minY)).coordinate.latitude)
    let south = max(
      -90, MKMapPoint(x: 0, y: min(MKMapRect.world.maxY, rect.maxY)).coordinate.latitude)
    let worldWidth = MKMapRect.world.width
    let rawBounds: [MarkerBounds]
    if rect.width >= worldWidth {
      rawBounds = [MarkerBounds(south: south, west: -180, north: north, east: 180)]
    } else {
      func longitude(_ x: Double) -> Double {
        let normalized = (x.truncatingRemainder(dividingBy: worldWidth) + worldWidth)
          .truncatingRemainder(dividingBy: worldWidth)
        return normalized / worldWidth * 360 - 180
      }
      let west = longitude(rect.minX)
      let east = longitude(rect.maxX)
      rawBounds =
        west <= east
        ? [MarkerBounds(south: south, west: west, north: north, east: east)]
        : [
          MarkerBounds(south: south, west: west, north: north, east: 180),
          MarkerBounds(south: south, west: -180, north: north, east: east),
        ]
    }
    // A viewport can straddle two datums. Enclose both interpretations instead of
    // shifting only its corners and losing places at coastlines/curved edges.
    // 0.02° conservatively covers the transform over the mainland coverage mask.
    bounds = rawBounds.map { bounds in
      guard space == .gcj02, bounds.east >= 73, bounds.west <= 136,
        bounds.north >= 18, bounds.south <= 54
      else { return bounds }
      return MarkerBounds(
        south: max(-90, bounds.south - 0.02),
        west: max(-180, bounds.west - 0.02), north: min(90, bounds.north + 0.02),
        east: min(180, bounds.east + 0.02))
    }
  }
}

struct MapFocus: Equatable {
  enum Target: Equatable {
    case point(GeoPoint)
    case userLocation
  }

  let id = UUID()
  let target: Target
  var distance: Double

  init(point: GeoPoint, distance: Double = 2_000) {
    self.init(target: .point(point), distance: distance)
  }

  init(target: Target, distance: Double = 2_000) {
    self.target = target
    self.distance = distance
  }
}
