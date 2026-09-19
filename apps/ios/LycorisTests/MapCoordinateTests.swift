import Foundation
import MapKit
import Testing

@testable import Lycoris

struct MapCoordinateTests {
  @Test func mainlandCoverageIncludesCitiesWithoutShiftingNeighbors() throws {
    for (latitude, longitude) in [
      (31.2304, 121.4737), (39.9042, 116.4074), (22.5431, 114.0579),
      (18.2528, 109.5119), (20.0440, 110.1999), (30.5728, 104.0668),
      (43.8256, 87.6168), (45.8038, 126.5349), (29.6520, 91.1721),
    ] {
      let original = GeoPoint(latitude: latitude, longitude: longitude)!
      #expect(MainlandCoverage.contains(original))
      let display = try #require(MapCoordinateSpace.gcj02.coordinate(for: original))
      let restored = try #require(MapCoordinateSpace.gcj02.point(from: display))
      #expect(original.distance(to: restored) < 0.01)
      #expect(original.coordinate.latitude == latitude)
      #expect(original.coordinate.longitude == longitude)
    }
    for (latitude, longitude) in [
      (22.3193, 114.1694), (22.1987, 113.5439), (25.0330, 121.5654),
      (37.5665, 126.9780), (21.0278, 105.8342), (35.6762, 139.6503),
      (27.7172, 85.3240), (43.1155, 131.8855), (40.766, -74.077),
    ] {
      let original = GeoPoint(latitude: latitude, longitude: longitude)!
      #expect(!MainlandCoverage.contains(original))
      for space in [MapCoordinateSpace.unresolved, .wgs84, .gcj02] {
        let display = try #require(space.coordinate(for: original))
        #expect(display.latitude == latitude && display.longitude == longitude)
        #expect(space.point(from: display) == original)
      }
    }
  }

  @Test func calibratedDisplayMatchesMeasuredPublicLandmark() throws {
    let original = GeoPoint(latitude: 31.2304, longitude: 121.4737)!
    let display = try #require(MapCoordinateSpace.gcj02.coordinate(for: original))
    // Independent coordtransform reference, not values calculated by this implementation.
    #expect(abs(display.latitude - 31.22845773757727) < 1e-9)
    #expect(abs(display.longitude - 121.47822305927693) < 1e-9)
    let applePOI = GeoPoint(latitude: 31.239703, longitude: 121.499718)!
    let tower = GeoPoint(latitude: 31.2418974784, longitude: 121.4952673205)!
    #expect(GCJ02.forward(tower).distance(to: applePOI) < 25)
    #expect(tower.distance(to: applePOI) > 450)
    let data = try JSONEncoder().encode(original)
    #expect(try JSONDecoder().decode(GeoPoint.self, from: data) == original)
  }

  @Test func ambiguousCoastalPickCannotMoveAnOutsideLocationInland() throws {
    let mainland = GeoPoint(latitude: 22.466, longitude: 113.9)!
    let overlapping = GCJ02.forward(mainland)
    #expect(MainlandCoverage.contains(mainland))
    #expect(!MainlandCoverage.contains(overlapping))
    #expect(MapCoordinateSpace.gcj02.point(from: overlapping.coordinate) == nil)
  }

  @MainActor @Test func resolverRejectsUnknownAndConflictingLandmarks() {
    let original = MapCoordinateResolver.landmark
    let shifted = GCJ02.forward(original)
    func match(_ point: GeoPoint, name: String = "东方明珠广播电视塔") -> MapCoordinateResolver.Candidate {
      .init(name: name, point: point)
    }
    #expect(MapCoordinateResolver.classify([match(original)]) == .wgs84)
    #expect(MapCoordinateResolver.classify([match(shifted)]) == .gcj02)
    #expect(MapCoordinateResolver.classify([match(original), match(shifted)]) == nil)
    #expect(MapCoordinateResolver.classify([match(shifted, name: "Unrelated restaurant")]) == nil)
    #expect(MapCoordinateResolver.classify([match(GeoPoint(latitude: 31, longitude: 121)!)]) == nil)
    #expect(MapCoordinateResolver.classify([]) == nil)
  }

  @MainActor @Test func unresolvedMapTapsCannotBecomeContributions() {
    let original = GeoPoint(latitude: 31.2304, longitude: 121.4737)!
    #expect(MapCoordinateSpace.unresolved.coordinate(for: original) == nil)
    #expect(MapCoordinateSpace.unresolved.point(from: GCJ02.forward(original).coordinate) == nil)
    let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    map.setCenter(GCJ02.forward(original).coordinate, animated: false)
    var picked: [GeoPoint] = []
    var unresolved = 0
    let coordinator = NativeMapView(
      topInset: 0, bottomInset: 0,
      coordinateSpace: .unresolved, isSelectingLocation: true,
      onPickLocation: { picked.append($0) }, onUnresolvedCoordinate: { unresolved += 1 }
    ).makeCoordinator()
    coordinator.pickLocation(at: CGPoint(x: 201, y: 437), on: map)
    #expect(picked.isEmpty && unresolved == 1)
  }

  @MainActor @Test(arguments: [0.0, 35.0, 170.0])
  func mapTapSavedCoordinateRendersBackUnderFinger(heading: Double) throws {
    let original = GeoPoint(latitude: 31.2304, longitude: 121.4737)!
    let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    map.setCamera(
      MKMapCamera(
        lookingAtCenter: GCJ02.forward(original).coordinate,
        fromDistance: 4000, pitch: 0, heading: heading), animated: false)
    var picked: GeoPoint?
    let coordinator = NativeMapView(
      topInset: 0, bottomInset: 0, coordinateSpace: .gcj02,
      isSelectingLocation: true, onPickLocation: { picked = $0 }
    ).makeCoordinator()
    let tap = CGPoint(x: 120, y: 320)
    coordinator.pickLocation(at: tap, on: map)
    let saved = try #require(picked)
    coordinator.parent.selectedLocation = saved
    coordinator.updateSelectedLocation(on: map)
    let annotation = try #require(map.annotations.first as? NativeMapView.LocationAnnotation)
    let displayed = map.convert(annotation.coordinate, toPointTo: map)
    #expect(abs(displayed.x - tap.x) < 1 && abs(displayed.y - tap.y) < 1)
    #expect(
      saved.distance(
        to: GeoPoint(
          latitude: annotation.coordinate.latitude,
          longitude: annotation.coordinate.longitude)!) > 300)
    let viewport = try #require(
      MapViewport(rect: map.visibleMapRect, center: map.centerCoordinate, space: .gcj02))
    #expect(viewport.center.distance(to: original) < 1)
    #expect(
      viewport.bounds.contains {
        saved.latitude >= $0.south && saved.latitude <= $0.north
          && saved.longitude >= $0.west && saved.longitude <= $0.east
      })
  }

  @MainActor @Test func resolverSharesLookupAndDiscardsCancelledResult() async throws {
    let service = DeferredCalibration()
    let resolver = MapCoordinateResolver(lookup: service.lookup)
    resolver.resolveIfNeeded()
    resolver.resolveIfNeeded()
    try await waitFor { service.requests == 1 }
    resolver.stop()
    service.finish(.gcj02)
    for _ in 0..<10 { await Task.yield() }
    #expect(resolver.space == .unresolved)
    resolver.resolveIfNeeded()
    try await waitFor { service.requests == 2 }
    service.finish(.wgs84)
    try await waitFor { resolver.space == .wgs84 }
    resolver.resolveIfNeeded()
    #expect(service.requests == 2)
  }

  @MainActor @Test func permissionRecoveryBeforeFailedLookupStillRetries() async throws {
    let service = DeferredCalibration()
    let resolver = MapCoordinateResolver(lookup: service.lookup)
    resolver.resolveIfNeeded()
    try await waitFor { service.requests == 1 }
    resolver.resolveIfNeeded(retryPending: true)
    service.finish(nil)
    try await waitFor { service.requests == 2 }
    service.finish(.gcj02)
    try await waitFor { resolver.space == .gcj02 }
    #expect(service.requests == 2)
  }

  @MainActor @Test(arguments: [false, true])
  func lateCalibrationRespectsUserCameraChanges(userMoved: Bool) throws {
    let original = GeoPoint(latitude: 31.2304, longitude: 121.4737)!
    let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    let coordinator = NativeMapView(
      topInset: 0, bottomInset: 0, coordinateSpace: .unresolved,
      focus: MapFocus(point: original), animated: false
    ).makeCoordinator()
    coordinator.applyFocus(on: map)
    if userMoved {
      map.setCamera(
        MKMapCamera(
          lookingAtCenter: CLLocationCoordinate2D(latitude: 32, longitude: 120),
          fromDistance: 5000, pitch: 0, heading: 30), animated: false)
    }
    let userCamera = map.camera.copy() as! MKMapCamera
    coordinator.prepareForCoordinateSpaceChange(on: map)
    coordinator.parent.coordinateSpace = .gcj02
    coordinator.applyFocus(on: map)
    let expected = userMoved ? userCamera.centerCoordinate : GCJ02.forward(original).coordinate
    #expect(abs(map.camera.centerCoordinate.latitude - expected.latitude) < 0.000001)
    #expect(abs(map.camera.centerCoordinate.longitude - expected.longitude) < 0.000001)
    if userMoved {
      #expect(abs(map.camera.centerCoordinateDistance - userCamera.centerCoordinateDistance) < 1)
      #expect(abs(map.camera.heading - userCamera.heading) < 0.1)
    }
  }

  @MainActor private func waitFor(_ condition: () -> Bool) async throws {
    for _ in 0..<100 {
      if condition() { return }
      try await Task.sleep(for: .milliseconds(5))
    }
    #expect(condition())
  }
}

@MainActor private final class DeferredCalibration {
  var requests = 0
  var continuation: CheckedContinuation<MapCoordinateSpace?, Never>?
  func lookup() async -> MapCoordinateSpace? {
    requests += 1
    return await withCheckedContinuation { continuation = $0 }
  }
  func finish(_ space: MapCoordinateSpace?) {
    continuation?.resume(returning: space)
    continuation = nil
  }
}
