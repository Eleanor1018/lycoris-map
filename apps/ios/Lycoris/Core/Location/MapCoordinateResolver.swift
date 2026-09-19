import MapKit
import Observation

/// MapKit has no public provider/datum flag. Calibrate its public POI coordinates
/// against one fixed landmark, never the user's location. See coordinate-alignment.md.
@MainActor @Observable
final class MapCoordinateResolver {
  private(set) var space: MapCoordinateSpace
  private var task: Task<Void, Never>?
  private var generation = UUID()
  private var retryRequested = false
  private let lookup: @MainActor () async -> MapCoordinateSpace?

  init(
    space: MapCoordinateSpace = .unresolved,
    lookup: (@MainActor () async -> MapCoordinateSpace?)? = nil
  ) {
    self.space = space
    self.lookup = lookup ?? Self.lookup
  }

  func resolveIfNeeded(retryPending: Bool = false) {
    guard space == .unresolved else { return }
    guard task == nil else {
      retryRequested = retryRequested || retryPending
      return
    }
    let token = generation
    let lookup = lookup
    task = Task { [weak self] in
      let result = await lookup()
      guard !Task.isCancelled, let self, generation == token else { return }
      if let result { space = result }
      task = nil
      let shouldRetry = retryRequested
      retryRequested = false
      if result == nil && shouldRetry { resolveIfNeeded() }
    }
  }

  func stop() {
    generation = UUID()
    task?.cancel()
    task = nil
    retryRequested = false
  }

  struct Candidate: Sendable {
    let name: String
    let point: GeoPoint
  }

  // OSM way 40778038 v45, building vertex mean. The actual POI may be within
  // the building, so allow 100m, while requiring >250m separation from the other datum.
  static let landmark = GeoPoint(latitude: 31.2418974784, longitude: 121.4952673205)!

  static func classify(_ candidates: [Candidate]) -> MapCoordinateSpace? {
    let shifted = GCJ02.forward(landmark)
    var matches: [MapCoordinateSpace] = []
    for candidate in candidates {
      let name = candidate.name.lowercased()
      guard
        name == "东方明珠广播电视塔" || name == "东方明珠" || name == "东方明珠电视塔"
          || name == "oriental pearl tower" || name == "oriental pearl radio & tv tower"
          || name == "oriental pearl radio and television tower"
          || name == "oriental pearl radio & television tower"
          || name == "東方明珠廣播電視塔" || name == "東方明珠電視塔"
      else { continue }
      let originalDistance = candidate.point.distance(to: landmark)
      let shiftedDistance = candidate.point.distance(to: shifted)
      if originalDistance < 100 && shiftedDistance > 250 { matches.append(.wgs84) }
      if shiftedDistance < 100 && originalDistance > 250 { matches.append(.gcj02) }
    }
    guard let first = matches.first, matches.allSatisfy({ $0 == first }) else { return nil }
    return first
  }

  private static func lookup() async -> MapCoordinateSpace? {
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = "东方明珠广播电视塔"
    request.resultTypes = .pointOfInterest
    request.region = MKCoordinateRegion(
      center: landmark.coordinate,
      latitudinalMeters: 3000, longitudinalMeters: 3000)
    request.regionPriority = .required
    let search = MKLocalSearch(request: request)
    let cancel: @MainActor @Sendable () -> Void = { search.cancel() }
    let timeout = Task {
      do { try await Task.sleep(for: .seconds(8)) } catch { return }
      search.cancel()
    }
    defer { timeout.cancel() }
    return await withTaskCancellationHandler {
      guard let response = try? await search.start(), !Task.isCancelled else { return nil }
      return classify(
        response.mapItems.compactMap { item in
          let coordinate = item.location.coordinate
          guard let point = GeoPoint(latitude: coordinate.latitude, longitude: coordinate.longitude)
          else { return nil }
          return Candidate(name: item.name ?? "", point: point)
        })
    } onCancel: {
      Task { @MainActor in cancel() }
    }
  }
}
