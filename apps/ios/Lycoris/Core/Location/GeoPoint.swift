import CoreLocation
import MapKit

/// API/database and Core Location coordinates are passed through as WGS84.
/// Never apply a second regional offset to MapKit coordinates.
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

  init?(rect: MKMapRect, center: CLLocationCoordinate2D) {
    guard let center = GeoPoint(latitude: center.latitude, longitude: center.longitude),
      !rect.isNull, !rect.isEmpty, rect.size.width.isFinite, rect.size.height.isFinite
    else { return nil }
    self.center = center
    let north = min(90, MKMapPoint(x: 0, y: max(0, rect.minY)).coordinate.latitude)
    let south = max(
      -90, MKMapPoint(x: 0, y: min(MKMapRect.world.maxY, rect.maxY)).coordinate.latitude)
    let worldWidth = MKMapRect.world.width
    if rect.width >= worldWidth {
      bounds = [MarkerBounds(south: south, west: -180, north: north, east: 180)]
    } else {
      func longitude(_ x: Double) -> Double {
        let normalized = (x.truncatingRemainder(dividingBy: worldWidth) + worldWidth)
          .truncatingRemainder(dividingBy: worldWidth)
        return normalized / worldWidth * 360 - 180
      }
      let west = longitude(rect.minX)
      let east = longitude(rect.maxX)
      bounds =
        west <= east
        ? [MarkerBounds(south: south, west: west, north: north, east: east)]
        : [
          MarkerBounds(south: south, west: west, north: north, east: 180),
          MarkerBounds(south: south, west: -180, north: north, east: east),
        ]
    }
  }
}

struct MapFocus: Equatable {
  let id = UUID()
  let point: GeoPoint
  var distance: Double = 2_000
}
