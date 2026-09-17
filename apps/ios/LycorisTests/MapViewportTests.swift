import MapKit
import Testing

@testable import Lycoris

struct MapViewportTests {
  @MainActor @Test(arguments: [0.0, 35.0, 170.0])
  func locationSelectionUsesTheTouchedCoordinateAndSurvivesCameraChanges(heading: Double) throws {
    let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    map.layoutMargins = UIEdgeInsets(top: 62, left: 10, bottom: 106, right: 10)
    map.setCamera(
      MKMapCamera(
        lookingAtCenter: CLLocationCoordinate2D(latitude: 40.766, longitude: -74.077),
        fromDistance: 14_000, pitch: 0, heading: heading), animated: false)
    var picked: [GeoPoint] = []
    let coordinator = NativeMapView(
      topInset: 62, bottomInset: 106, isSelectingLocation: true,
      onPickLocation: { picked.append($0) }
    ).makeCoordinator()
    let tap = CGPoint(x: 93, y: 307)
    coordinator.pickLocation(at: tap, on: map)
    let point = try #require(picked.first)
    let actual = map.convert(point.coordinate, toPointTo: map)
    #expect(abs(actual.x - tap.x) < 1 && abs(actual.y - tap.y) < 1)
    coordinator.parent.selectedLocation = point
    coordinator.updateSelectedLocation(on: map)
    let pin = try #require(map.annotations.first as? NativeMapView.LocationAnnotation)

    map.setCamera(
      MKMapCamera(
        lookingAtCenter: CLLocationCoordinate2D(latitude: 40.77, longitude: -74.07),
        fromDistance: 4_000, pitch: 0, heading: heading + 20), animated: false)
    coordinator.updateSelectedLocation(on: map)
    #expect(pin.coordinate.latitude == point.latitude)
    #expect(pin.coordinate.longitude == point.longitude)
    #expect(picked.count == 1)

    coordinator.pickLocation(at: CGPoint(x: 284, y: 420), on: map)
    coordinator.parent.selectedLocation = try #require(picked.last)
    coordinator.updateSelectedLocation(on: map)
    #expect(map.annotations.count == 1 && map.annotations.first === pin)
    #expect(pin.coordinate.latitude != point.latitude)
    coordinator.pickLocation(at: CGPoint(x: -1, y: 200), on: map)
    #expect(picked.count == 2)
    coordinator.parent.isSelectingLocation = false
    coordinator.pickLocation(at: tap, on: map)
    coordinator.updateSelectedLocation(on: map)
    #expect(picked.count == 2)
    #expect(map.annotations.isEmpty)
  }

  @MainActor @Test func changingMapAppearancePreservesCameraAndPins() {
    let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    let center = CLLocationCoordinate2D(latitude: 40.766, longitude: -74.077)
    map.setCamera(
      MKMapCamera(lookingAtCenter: center, fromDistance: 14_000, pitch: 0, heading: 35),
      animated: false)
    let pin = MKPointAnnotation()
    pin.coordinate = center
    map.addAnnotation(pin)
    let anchor = map.convert(center, toPointTo: map)
    let distance = map.camera.centerCoordinateDistance
    for appearance in [MapAppearance.satellite, .explore] {
      map.preferredConfiguration = appearance.configuration()
      let actual = map.convert(center, toPointTo: map)
      #expect(abs(actual.x - anchor.x) < 1 && abs(actual.y - anchor.y) < 1)
      #expect(abs(map.camera.centerCoordinateDistance - distance) < 1)
      #expect(abs(map.camera.heading - 35) < 0.1)
      #expect(map.annotations.contains { $0 === pin })
    }
    #expect(MapAppearance.satellite.configuration() is MKHybridMapConfiguration)
  }

  @MainActor @Test(arguments: [0.0, 35.0, 170.0])
  func panelInsetsPreserveTheVisibleMap(heading: Double) {
    let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    map.layoutMargins = UIEdgeInsets(top: 62, left: 10, bottom: 106, right: 10)
    map.setCamera(
      MKMapCamera(
        lookingAtCenter: CLLocationCoordinate2D(latitude: 40.766, longitude: -74.077),
        fromDistance: 14_000, pitch: 0, heading: heading), animated: false)
    let screenPoint = CGPoint(x: 140, y: 300)
    let coordinate = map.convert(screenPoint, toCoordinateFrom: map)
    let distance = map.camera.centerCoordinateDistance

    for bottom in [282.0, 810.0, 106.0] {
      NativeMapView.updateMargins(
        UIEdgeInsets(top: 62, left: 10, bottom: bottom, right: 10), on: map)
      let actual = map.convert(coordinate, toPointTo: map)
      #expect(abs(actual.x - screenPoint.x) < 1)
      #expect(abs(actual.y - screenPoint.y) < 1)
      #expect(abs(map.camera.centerCoordinateDistance - distance) < 1)
      #expect(abs(map.camera.heading - heading) < 0.1)
    }
  }
}
