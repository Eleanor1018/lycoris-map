import MapKit
import Testing

@testable import Lycoris

struct MapViewportTests {
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
