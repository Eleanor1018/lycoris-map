import MapKit
import SwiftUI

/// One persistent MapKit instance. Only explicit place/location selection moves its camera.
struct NativeMapView: UIViewRepresentable {
  let topInset: CGFloat
  let bottomInset: CGFloat
  var appearance: MapAppearance = .explore
  var places: [PlacePresentation] = []
  var focus: MapFocus? = nil
  var showsUserLocation = false
  var animated = true
  var isSelectingLocation = false
  var selectedLocation: GeoPoint?
  var onPickLocation: (GeoPoint) -> Void = { _ in }
  var onViewport: (MapViewport) -> Void = { _ in }
  var onSelect: (PlacePresentation) -> Void = { _ in }
  var onScreenCenter: (GeoPoint) -> Void = { _ in }

  func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

  func makeUIView(context: Context) -> MKMapView {
    let map = MKMapView(frame: .zero)
    map.delegate = context.coordinator
    map.preferredConfiguration = appearance.configuration()
    context.coordinator.appearance = appearance
    map.showsCompass = false
    map.isPitchEnabled = false
    let tap = UITapGestureRecognizer(
      target: context.coordinator, action: #selector(Coordinator.pickLocation(_:)))
    tap.delegate = context.coordinator
    tap.cancelsTouchesInView = false
    tap.isEnabled = isSelectingLocation
    // MapKit's zoom recognizer isn't necessarily a UITapGestureRecognizer.
    // Observe double taps ourselves so the single tap always waits for them.
    let doubleTap = UITapGestureRecognizer()
    doubleTap.numberOfTapsRequired = 2
    doubleTap.cancelsTouchesInView = false
    doubleTap.delaysTouchesEnded = false
    doubleTap.delegate = context.coordinator
    doubleTap.isEnabled = isSelectingLocation
    tap.require(toFail: doubleTap)
    context.coordinator.placementTap = tap
    context.coordinator.placementDoubleTap = doubleTap
    map.addGestureRecognizer(doubleTap)
    map.addGestureRecognizer(tap)
    map.layoutMargins = UIEdgeInsets(top: topInset, left: 10, bottom: bottomInset, right: 10)
    var center = CLLocationCoordinate2D(latitude: 40.766, longitude: -74.077)
    #if DEBUG
      // Explicit simulator verification override; regular launches keep the design's camera.
      let arguments = ProcessInfo.processInfo.arguments
      if let index = arguments.firstIndex(of: "-lycoris-test-center"),
        arguments.indices.contains(index + 1)
      {
        let values = arguments[index + 1].split(separator: ",").compactMap { Double($0) }
        if values.count == 2, let point = GeoPoint(latitude: values[0], longitude: values[1]) {
          center = point.coordinate
        }
      }
    #endif
    map.setCamera(
      MKMapCamera(lookingAtCenter: center, fromDistance: 14_000, pitch: 0, heading: 0),
      animated: false)
    return map
  }

  func updateUIView(_ map: MKMapView, context: Context) {
    let coordinator = context.coordinator
    coordinator.parent = self
    coordinator.placementTap?.isEnabled = isSelectingLocation
    coordinator.placementDoubleTap?.isEnabled = isSelectingLocation
    coordinator.updateSelectedLocation(on: map)
    if coordinator.appearance != appearance {
      map.preferredConfiguration = appearance.configuration()
      coordinator.appearance = appearance
    }
    Self.updateMargins(
      UIEdgeInsets(top: topInset, left: 10, bottom: bottomInset, right: 10), on: map)
    map.showsUserLocation = showsUserLocation
    let existing = Dictionary(
      uniqueKeysWithValues: map.annotations.compactMap { annotation -> (String, PlaceAnnotation)? in
        guard let pin = annotation as? PlaceAnnotation else { return nil }
        return (pin.place.id, pin)
      })
    let ids = Set(places.map(\.id))
    map.removeAnnotations(existing.filter { !ids.contains($0.key) }.map(\.value))
    for place in places {
      guard let point = place.point else { continue }
      if let pin = existing[place.id] {
        pin.place = place
        map.view(for: pin)?.accessibilityLabel = place.title
        map.view(for: pin)?.isEnabled = !isSelectingLocation
        map.view(for: pin)?.isAccessibilityElement = !isSelectingLocation
        if pin.coordinate.latitude != point.latitude || pin.coordinate.longitude != point.longitude
        {
          pin.coordinate = point.coordinate
        }
      } else {
        map.addAnnotation(PlaceAnnotation(place: place, point: point))
      }
    }
    if let focus, coordinator.focusID != focus.id {
      coordinator.focusID = focus.id
      map.setCamera(
        MKMapCamera(
          lookingAtCenter: focus.point.coordinate,
          fromDistance: focus.distance, pitch: 0, heading: map.camera.heading), animated: animated)
    }
  }

  final class PlaceAnnotation: NSObject, MKAnnotation {
    var place: PlacePresentation
    @objc dynamic var coordinate: CLLocationCoordinate2D
    var title: String? { place.title }
    init(place: PlacePresentation, point: GeoPoint) {
      self.place = place
      coordinate = point.coordinate
    }
  }

  final class LocationAnnotation: NSObject, MKAnnotation {
    @objc dynamic var coordinate: CLLocationCoordinate2D
    init(point: GeoPoint) { coordinate = point.coordinate }
  }

  final class Coordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate {
    var parent: NativeMapView
    var focusID: UUID?
    var appearance: MapAppearance?
    var lastViewport: MapViewport?
    var placementTap: UITapGestureRecognizer?
    var placementDoubleTap: UITapGestureRecognizer?
    private var locationAnnotation: LocationAnnotation?
    init(parent: NativeMapView) { self.parent = parent }

    @objc func pickLocation(_ gesture: UITapGestureRecognizer) {
      guard gesture.state == .ended, let map = gesture.view as? MKMapView else { return }
      pickLocation(at: gesture.location(in: map), on: map)
    }

    func pickLocation(at position: CGPoint, on map: MKMapView) {
      guard parent.isSelectingLocation, map.bounds.contains(position) else { return }
      let coordinate = map.convert(position, toCoordinateFrom: map)
      guard let point = GeoPoint(latitude: coordinate.latitude, longitude: coordinate.longitude)
      else { return }
      parent.onPickLocation(point)
    }

    func gestureRecognizer(
      _ gestureRecognizer: UIGestureRecognizer,
      shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
      // A double tap zooms; it must finish before a single tap can place a pin.
      gestureRecognizer === placementTap
        && ((otherGestureRecognizer as? UITapGestureRecognizer)?.numberOfTapsRequired ?? 0) > 1
    }

    func gestureRecognizer(
      _ gestureRecognizer: UIGestureRecognizer,
      shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
      // This observer must not consume MapKit's native zoom gesture.
      if gestureRecognizer === placementDoubleTap { return true }
      guard gestureRecognizer === placementTap,
        let other = otherGestureRecognizer as? UITapGestureRecognizer
      else { return false }
      // MapKit can also recognize the tap, including over an existing annotation.
      return other.numberOfTapsRequired == 1 && other.numberOfTouchesRequired == 1
    }

    func updateSelectedLocation(on map: MKMapView) {
      guard parent.isSelectingLocation, let point = parent.selectedLocation else {
        if let locationAnnotation { map.removeAnnotation(locationAnnotation) }
        locationAnnotation = nil
        return
      }
      if let locationAnnotation {
        if locationAnnotation.coordinate.latitude != point.latitude
          || locationAnnotation.coordinate.longitude != point.longitude
        {
          locationAnnotation.coordinate = point.coordinate
        }
      } else {
        let pin = LocationAnnotation(point: point)
        locationAnnotation = pin
        map.addAnnotation(pin)
      }
      if let locationAnnotation, let view = map.view(for: locationAnnotation) {
        view.accessibilityLabel = String(appLocalized: "Selected location")
      }
    }

    func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
      publishViewport(mapView)
    }
    func mapViewDidFinishLoadingMap(_ mapView: MKMapView) { publishViewport(mapView) }

    private func publishViewport(_ map: MKMapView) {
      guard map.bounds.width > 0, map.bounds.height > 0 else { return }
      let coordinate = map.convert(
        CGPoint(x: map.bounds.midX, y: map.bounds.midY), toCoordinateFrom: map)
      if let point = GeoPoint(latitude: coordinate.latitude, longitude: coordinate.longitude) {
        Task { @MainActor [weak self] in self?.parent.onScreenCenter(point) }
      }
      guard map.bounds.width > 0,
        let viewport = MapViewport(rect: map.visibleMapRect, center: map.centerCoordinate),
        viewport != lastViewport
      else { return }
      lastViewport = viewport
      // MapKit can call its delegate while SwiftUI is updating the representable.
      Task { @MainActor [weak self] in self?.parent.onViewport(viewport) }
    }

    func mapView(_ mapView: MKMapView, viewFor annotation: any MKAnnotation) -> MKAnnotationView? {
      if annotation is LocationAnnotation {
        let view =
          mapView.dequeueReusableAnnotationView(withIdentifier: "selected-location")
          as? MKMarkerAnnotationView
          ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: "selected-location")
        view.annotation = annotation
        view.canShowCallout = false
        view.displayPriority = .required
        view.zPriority = .max
        view.accessibilityLabel = String(appLocalized: "Selected location")
        view.accessibilityIdentifier = "contribution.location-pin"
        return view
      }
      guard let pin = annotation as? PlaceAnnotation else { return nil }
      let view =
        mapView.dequeueReusableAnnotationView(withIdentifier: "place")
        ?? MKAnnotationView(annotation: annotation, reuseIdentifier: "place")
      view.annotation = annotation
      view.image = UIImage(named: "PlacePin")
      view.centerOffset = CGPoint(x: 0, y: -21.5)
      view.accessibilityLabel = pin.place.title
      view.accessibilityIdentifier = "map.pin.\(pin.place.id)"
      view.isEnabled = !parent.isSelectingLocation
      view.isAccessibilityElement = !parent.isSelectingLocation
      return view
    }

    func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
      guard let pin = view.annotation as? PlaceAnnotation else { return }
      if !parent.isSelectingLocation { parent.onSelect(pin.place) }
      mapView.deselectAnnotation(pin, animated: false)
    }
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
