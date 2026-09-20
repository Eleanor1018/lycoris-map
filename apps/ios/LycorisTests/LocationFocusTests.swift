import MapKit
import Testing

@testable import Lycoris

struct LocationFocusTests {
  @MainActor @Test(arguments: [MapCoordinateSpace.unresolved, .wgs84, .gcj02])
  func locatingStillFollowsTheNativeBlueDotWhenCalibrationIsUnavailable(space: MapCoordinateSpace) {
    let store = PlaceStore(isPreview: true)
    let token = store.beginLocationRequest()
    store.locate(GeoPoint(latitude: 31.2304, longitude: 121.4737)!, token: token)
    let map = TrackingMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    let coordinator = NativeMapView(
      topInset: 0, bottomInset: 0, coordinateSpace: space,
      focus: store.focus, showsUserLocation: true, animated: false
    ).makeCoordinator()
    coordinator.applyFocus(on: map)
    #expect(map.trackingRequests == [.follow])
    #expect(store.userLocation == GeoPoint(latitude: 31.2304, longitude: 121.4737))
  }

  @MainActor @Test func lateCalibrationCannotRestartFollowingAfterUserPans() {
    let map = TrackingMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    let coordinator = NativeMapView(
      topInset: 0, bottomInset: 0, coordinateSpace: .unresolved,
      focus: MapFocus(target: .userLocation), showsUserLocation: true, animated: false
    ).makeCoordinator()
    coordinator.applyFocus(on: map)
    map.setCenter(CLLocationCoordinate2D(latitude: 32, longitude: 120), animated: false)
    coordinator.prepareForCoordinateSpaceChange(on: map)
    coordinator.parent.coordinateSpace = .gcj02
    coordinator.applyFocus(on: map)
    #expect(map.trackingRequests == [.follow])
    #expect(abs(map.centerCoordinate.latitude - 32) < 0.000001)
    #expect(abs(map.centerCoordinate.longitude - 120) < 0.000001)
  }

  @MainActor @Test func nativeFocusWaitsForAuthorizationAndPlaceSelectionEndsFollowing() throws {
    let map = TrackingMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    let coordinator = NativeMapView(
      topInset: 0, bottomInset: 0, coordinateSpace: .gcj02,
      focus: MapFocus(target: .userLocation), animated: false
    ).makeCoordinator()
    coordinator.applyFocus(on: map)
    #expect(map.trackingRequests.isEmpty)
    coordinator.parent.showsUserLocation = true
    coordinator.applyFocus(on: map)
    let point = GeoPoint(latitude: 31.2304, longitude: 121.4737)!
    coordinator.parent.focus = MapFocus(point: point)
    coordinator.applyFocus(on: map)
    #expect(map.trackingRequests == [.follow, .none])
    let expected = try #require(MapCoordinateSpace.gcj02.coordinate(for: point))
    #expect(abs(map.centerCoordinate.latitude - expected.latitude) < 0.000001)
    #expect(abs(map.centerCoordinate.longitude - expected.longitude) < 0.000001)
  }

  @MainActor @Test func lateCanonicalFixDoesNotReplayManualCameraIntent() {
    let store = PlaceStore(isPreview: true)
    let token = store.beginLocationRequest()
    store.followUserLocation(token: token)
    let intent = store.focus
    let point = GeoPoint(latitude: 31.2304, longitude: 121.4737)!
    store.locate(point, token: token, focusMap: false)
    #expect(store.userLocation == point)
    #expect(store.focus == intent)
    store.revokeLocation()
    store.followUserLocation(token: token)
    store.locate(point, token: token)
    #expect(store.focus == nil && store.userLocation == nil)
  }

  @MainActor @Test func nearbyUsesCanonicalGPSDataButNativeCameraFocus() {
    let store = PlaceStore(api: MarkerAPI(baseURL: nil))
    defer { store.stop() }
    let token = store.nearby(.toilet)
    let point = GeoPoint(latitude: 31.2304, longitude: 121.4737)!
    store.resolveNearbyLocation(point, token: token)
    #expect(store.browse == .nearby(category: .toilet, center: point, located: true))
    #expect(store.userLocation == point)
    #expect(store.focus?.target == .userLocation)
  }

  @MainActor @Test func layoutChangesDoNotOverrideNativeFollowingWithAnExplicitCamera() {
    let map = TrackingMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    map.setUserTrackingMode(.follow, animated: false)
    let cameraRequests = map.explicitCameraRequests
    let insets = UIEdgeInsets(top: 62, left: 10, bottom: 140, right: 10)
    NativeMapView.updateMargins(insets, on: map)
    #expect(map.layoutMargins == insets)
    #expect(map.explicitCameraRequests == cameraRequests)
    #expect(map.userTrackingMode == .follow)
  }
}

@MainActor private final class TrackingMapView: MKMapView {
  var trackingRequests: [MKUserTrackingMode] = []
  var explicitCameraRequests = 0
  override var userTrackingMode: MKUserTrackingMode {
    get { trackingRequests.last ?? .none }
    set { trackingRequests.append(newValue) }
  }
  override func setUserTrackingMode(_ mode: MKUserTrackingMode, animated: Bool) {
    trackingRequests.append(mode)
  }
  override func setCamera(_ camera: MKMapCamera, animated: Bool) {
    explicitCameraRequests += 1
    super.setCamera(camera, animated: animated)
  }
}
