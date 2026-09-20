import MapKit
import SwiftUI

/// One persistent MapKit instance. The initial fix and explicit selections move its camera.
struct NativeMapView: UIViewRepresentable {
  let topInset: CGFloat
  let bottomInset: CGFloat
  var appearance: MapAppearance = .explore
  var coordinateSpace: MapCoordinateSpace = .wgs84
  var places: [PlacePresentation] = []
  var focus: MapFocus? = nil
  var showsUserLocation = false
  var isActive = true
  var animated = true
  var isSelectingLocation = false
  var selectedLocation: GeoPoint?
  var onPickLocation: (GeoPoint) -> Void = { _ in }
  var onUnresolvedCoordinate: () -> Void = {}
  var onViewport: (MapViewport) -> Void = { _ in }
  var onSelect: (PlacePresentation) -> Void = { _ in }
  var onScreenCenter: (GeoPoint?) -> Void = { _ in }

  func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

  func makeUIView(context: Context) -> MKMapView {
    let map = HeadingMapView(frame: .zero)
    map.delegate = context.coordinator
    map.onGeometryChange = { [weak coordinator = context.coordinator] map in
      coordinator?.updateHeading(on: map)
    }
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
      // Explicit simulator verification override; a startup fix can replace this fallback.
      let arguments = ProcessInfo.processInfo.arguments
      if let index = arguments.firstIndex(of: "-lycoris-test-center"),
        arguments.indices.contains(index + 1)
      {
        let values = arguments[index + 1].split(separator: ",").compactMap { Double($0) }
        if values.count == 2, let point = GeoPoint(latitude: values[0], longitude: values[1]) {
          center = coordinateSpace.coordinate(for: point) ?? center
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
    let spaceChanged = coordinator.parent.coordinateSpace != coordinateSpace
    if spaceChanged {
      coordinator.prepareForCoordinateSpaceChange(on: map)
    }
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
    if !showsUserLocation && map.userTrackingMode != .none {
      map.setUserTrackingMode(.none, animated: false)
    }
    coordinator.updateHeading(on: map)
    let existing = Dictionary(
      uniqueKeysWithValues: map.annotations.compactMap { annotation -> (String, PlaceAnnotation)? in
        guard let pin = annotation as? PlaceAnnotation else { return nil }
        return (pin.place.id, pin)
      })
    let ids = Set(places.filter { $0.point.flatMap(coordinateSpace.coordinate) != nil }.map(\.id))
    map.removeAnnotations(existing.filter { !ids.contains($0.key) }.map(\.value))
    for place in places {
      guard let point = place.point, let coordinate = coordinateSpace.coordinate(for: point)
      else { continue }
      if let pin = existing[place.id] {
        pin.place = place
        if let view = map.view(for: pin) { coordinator.configure(view, for: pin) }
        if pin.coordinate.latitude != coordinate.latitude
          || pin.coordinate.longitude != coordinate.longitude
        {
          pin.coordinate = coordinate
        }
      } else {
        map.addAnnotation(PlaceAnnotation(place: place, coordinate: coordinate))
      }
    }
    coordinator.applyFocus(on: map)
    if spaceChanged { coordinator.publishViewport(map) }
  }

  static func dismantleUIView(_ map: MKMapView, coordinator: Coordinator) {
    (map as? HeadingMapView)?.onGeometryChange = nil
    coordinator.headingProvider.stop()
    map.delegate = nil
  }

  /// Use this map's window orientation, including iPad windows and rotation lock.
  final class HeadingMapView: MKMapView {
    var onGeometryChange: ((MKMapView) -> Void)?

    override func layoutSubviews() {
      super.layoutSubviews()
      onGeometryChange?(self)
    }

    override func didMoveToWindow() {
      super.didMoveToWindow()
      onGeometryChange?(self)
    }
  }

  final class PlaceAnnotation: NSObject, MKAnnotation {
    var place: PlacePresentation
    @objc dynamic var coordinate: CLLocationCoordinate2D
    var title: String? { place.title }
    init(place: PlacePresentation, coordinate: CLLocationCoordinate2D) {
      self.place = place
      self.coordinate = coordinate
    }
  }

  final class LocationAnnotation: NSObject, MKAnnotation {
    @objc dynamic var coordinate: CLLocationCoordinate2D
    init(coordinate: CLLocationCoordinate2D) { self.coordinate = coordinate }
  }

  final class Coordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate {
    var parent: NativeMapView
    var focusID: UUID?
    private var lastFocusCamera: MKMapCamera?
    var appearance: MapAppearance?
    var lastViewport: MapViewport?
    var placementTap: UITapGestureRecognizer?
    var placementDoubleTap: UITapGestureRecognizer?
    private var locationAnnotation: LocationAnnotation?
    let headingProvider = UserHeadingProvider()
    private weak var map: MKMapView?
    init(parent: NativeMapView) {
      self.parent = parent
      super.init()
      headingProvider.onChange = { [weak self] in
        guard let self, let map = self.map else { return }
        self.updateHeadingView(on: map, animated: self.parent.animated)
      }
    }

    func prepareForCoordinateSpaceChange(on map: MKMapView) {
      lastViewport = nil
      // MapKit owns the blue-dot coordinate; calibration must never replay its focus.
      guard parent.focus?.target != .userLocation else { return }
      // Also record deferred focuses: a late calibration must not undo a pan/zoom
      // made while the first mainland location was waiting for its projection.
      guard let last = lastFocusCamera else { return }
      let current = map.camera
      if abs(current.centerCoordinate.latitude - last.centerCoordinate.latitude) < 0.000001,
        abs(current.centerCoordinate.longitude - last.centerCoordinate.longitude) < 0.000001,
        abs(current.centerCoordinateDistance - last.centerCoordinateDistance) < 1,
        abs(current.heading - last.heading) < 0.1
      {
        focusID = nil
      }
    }

    func applyFocus(on map: MKMapView) {
      guard let focus = parent.focus, focusID != focus.id else { return }
      switch focus.target {
      case .userLocation:
        guard parent.showsUserLocation else { return }
        focusID = focus.id
        lastFocusCamera = nil
        // Native follow waits for MapKit's own fix and uses the blue dot's display
        // coordinate. It must work even when landmark search is offline/unresolved.
        map.setUserTrackingMode(.follow, animated: parent.animated)
      case .point(let point):
        focusID = focus.id
        map.setUserTrackingMode(.none, animated: false)
        if let coordinate = parent.coordinateSpace.coordinate(for: point) {
          map.setCamera(
            MKMapCamera(
              lookingAtCenter: coordinate,
              fromDistance: focus.distance, pitch: 0, heading: map.camera.heading),
            animated: parent.animated)
        }
        lastFocusCamera = map.camera.copy() as? MKMapCamera
      }
      updateLocationTestState(on: map)
    }

    private func updateLocationTestState(on map: MKMapView) {
      #if LYCORIS_LOCAL_TESTS
        guard
          ProcessInfo.processInfo.arguments.contains("-lycoris-test-map-calibration-unavailable")
        else { return }
        // No coordinates or test diagnostics are exposed by Debug/Release builds.
        map.accessibilityValue =
          "tracking=\(map.userTrackingMode.rawValue); calibration=\(parent.coordinateSpace)"
      #endif
    }

    func updateHeading(on map: MKMapView) {
      self.map = map
      headingProvider.update(
        enabled: parent.showsUserLocation && parent.isActive && map.window != nil,
        orientation: map.window?.windowScene?.effectiveGeometry.interfaceOrientation ?? .portrait)
      updateHeadingView(on: map, animated: false)
    }

    private func updateHeadingView(on map: MKMapView, animated: Bool) {
      guard let view = map.view(for: map.userLocation) as? DirectionalUserLocationView else {
        return
      }
      let hasFix = map.userLocation.location.map { $0.horizontalAccuracy >= 0 } ?? false
      view.update(
        heading: parent.showsUserLocation && parent.isActive && hasFix
          ? headingProvider.heading : nil,
        mapHeading: map.camera.heading, animated: animated)
    }

    func mapViewDidChangeVisibleRegion(_ mapView: MKMapView) {
      updateHeadingView(on: mapView, animated: false)
      updateLocationTestState(on: mapView)
    }

    func mapView(_ mapView: MKMapView, didUpdate userLocation: MKUserLocation) {
      updateHeadingView(on: mapView, animated: false)
      updateLocationTestState(on: mapView)
    }

    func mapView(_ mapView: MKMapView, didChange mode: MKUserTrackingMode, animated: Bool) {
      updateLocationTestState(on: mapView)
    }

    func mapView(_ mapView: MKMapView, didAdd views: [MKAnnotationView]) {
      updateHeadingView(on: mapView, animated: false)
    }

    @objc func pickLocation(_ gesture: UITapGestureRecognizer) {
      guard gesture.state == .ended, let map = gesture.view as? MKMapView else { return }
      pickLocation(at: gesture.location(in: map), on: map)
    }

    func pickLocation(at position: CGPoint, on map: MKMapView) {
      guard parent.isSelectingLocation, map.bounds.contains(position) else { return }
      let coordinate = map.convert(position, toCoordinateFrom: map)
      guard let point = parent.coordinateSpace.point(from: coordinate) else {
        parent.onUnresolvedCoordinate()
        return
      }
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
      guard parent.isSelectingLocation, let point = parent.selectedLocation,
        let coordinate = parent.coordinateSpace.coordinate(for: point)
      else {
        if let locationAnnotation { map.removeAnnotation(locationAnnotation) }
        locationAnnotation = nil
        return
      }
      if let locationAnnotation {
        if locationAnnotation.coordinate.latitude != coordinate.latitude
          || locationAnnotation.coordinate.longitude != coordinate.longitude
        {
          locationAnnotation.coordinate = coordinate
        }
      } else {
        let pin = LocationAnnotation(coordinate: coordinate)
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

    func publishViewport(_ map: MKMapView) {
      guard map.bounds.width > 0, map.bounds.height > 0 else { return }
      let coordinate = map.convert(
        CGPoint(x: map.bounds.midX, y: map.bounds.midY), toCoordinateFrom: map)
      let space = parent.coordinateSpace
      let point = space.point(from: coordinate)
      Task { @MainActor [weak self] in
        guard self?.parent.coordinateSpace == space else { return }
        self?.parent.onScreenCenter(point)
      }
      guard map.bounds.width > 0,
        let viewport = MapViewport(
          rect: map.visibleMapRect, center: map.centerCoordinate, space: space),
        viewport != lastViewport
      else { return }
      lastViewport = viewport
      // MapKit can call its delegate while SwiftUI is updating the representable.
      Task { @MainActor [weak self] in
        guard self?.parent.coordinateSpace == space else { return }
        self?.parent.onViewport(viewport)
      }
    }

    func mapView(_ mapView: MKMapView, viewFor annotation: any MKAnnotation) -> MKAnnotationView? {
      if annotation is MKUserLocation {
        let view =
          mapView.dequeueReusableAnnotationView(withIdentifier: "user-location")
          as? DirectionalUserLocationView
          ?? DirectionalUserLocationView(annotation: annotation, reuseIdentifier: "user-location")
        view.annotation = annotation
        return view
      }
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
      configure(view, for: pin)
      return view
    }

    func configure(_ view: MKAnnotationView, for pin: PlaceAnnotation) {
      view.image = UIImage(named: pin.place.category.pinAsset)
      // The 43pt asset includes a shadow below its tip at y=39. Anchor the tip,
      // not the image bottom, to the geographic point.
      view.centerOffset = CGPoint(x: 0, y: -17.5)
      view.accessibilityLabel = pin.place.title
      view.accessibilityIdentifier = "map.pin.\(pin.place.id)"
      view.isEnabled = !parent.isSelectingLocation
      view.isAccessibilityElement = !parent.isSelectingLocation
    }

    func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
      guard let pin = view.annotation as? PlaceAnnotation else { return }
      if !parent.isSelectingLocation { parent.onSelect(pin.place) }
      mapView.deselectAnnotation(pin, animated: false)
    }
  }

  static func updateMargins(_ insets: UIEdgeInsets, on map: MKMapView) {
    guard map.layoutMargins != insets else { return }
    if map.userTrackingMode != .none {
      // Let MapKit keep the blue dot in the unobscured region. An explicit
      // camera correction here would compete with native user following.
      map.layoutMargins = insets
      return
    }
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
