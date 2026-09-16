import MapKit
import SwiftUI

/// Public layout margins place attribution above the panel's lowest detent.
/// Geometry changes preserve the camera rather than reframing the map.
struct NativeMapView: UIViewRepresentable {
  let topInset: CGFloat
  let bottomInset: CGFloat

  func makeUIView(context: Context) -> MKMapView {
    let map = MKMapView(frame: .zero)
    map.preferredConfiguration = MKStandardMapConfiguration(elevationStyle: .flat)
    map.showsCompass = false
    map.isPitchEnabled = false
    map.layoutMargins = UIEdgeInsets(top: topInset, left: 10, bottom: bottomInset, right: 10)
    map.setCamera(
      MKMapCamera(
        lookingAtCenter: CLLocationCoordinate2D(latitude: 40.766, longitude: -74.077),
        fromDistance: 14_000, pitch: 0, heading: 0),
      animated: false
    )
    return map
  }

  func updateUIView(_ map: MKMapView, context: Context) {
    let insets = UIEdgeInsets(top: topInset, left: 10, bottom: bottomInset, right: 10)
    Self.updateMargins(insets, on: map)
  }

  static func updateMargins(_ insets: UIEdgeInsets, on map: MKMapView) {
    guard map.layoutMargins != insets else { return }
    guard map.bounds.width > 0, map.bounds.height > 0 else {
      map.layoutMargins = insets
      return
    }
    // MapKit anchors its camera to the unobscured region. Keep the geographic
    // point under the physical screen center fixed when that region changes.
    // Convert through MapKit so rotation and Mercator projection stay native.
    let anchor = CGPoint(x: map.bounds.midX, y: map.bounds.midY)
    let coordinate = map.convert(anchor, toCoordinateFrom: map)
    let camera = map.camera
    UIView.performWithoutAnimation {
      map.layoutMargins = insets
      map.layoutIfNeeded()
      let shiftedAnchor = map.convert(coordinate, toPointTo: map)
      let focus = map.convert(camera.centerCoordinate, toPointTo: map)
      let correctedFocus = CGPoint(
        x: focus.x + shiftedAnchor.x - anchor.x,
        y: focus.y + shiftedAnchor.y - anchor.y
      )
      camera.centerCoordinate = map.convert(correctedFocus, toCoordinateFrom: map)
      map.setCamera(camera, animated: false)
    }
  }
}
