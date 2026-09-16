import Foundation
import Observation

@MainActor @Observable
final class PlaceStore {
  enum LoadState: Equatable {
    case idle, loading, loaded
    case failed(PlaceFailure)
  }
  enum Browse: Equatable {
    case search(String)
    case nearby(category: PlaceCategory, center: GeoPoint, located: Bool)
  }

  let isPreview: Bool
  private let api: any MarkerServing
  private(set) var viewport: MapViewport?
  private(set) var viewportMarkers: [Marker] = []
  private(set) var results: [Marker] = []
  private(set) var browse: Browse?
  private(set) var pendingNearby: PlaceCategory?
  private(set) var viewportState: LoadState = .idle
  private(set) var resultsState: LoadState = .idle
  private(set) var detailState: LoadState = .idle
  private(set) var selectedPlace: PlacePresentation?
  private(set) var userLocation: GeoPoint?
  private(set) var focus: MapFocus?
  private(set) var lastRequestID: String?
  private(set) var language: String
  private var viewportTask: Task<Void, Never>?
  private var browseTask: Task<Void, Never>?
  private var detailTask: Task<Void, Never>?
  private var viewportGeneration = UUID()
  private var browseGeneration = UUID()
  private var detailGeneration = UUID()
  private var locationGeneration = UUID()

  init(
    api: any MarkerServing = MarkerAPI(), isPreview: Bool = false,
    initialPlace: PlacePresentation? = nil, language: String? = nil
  ) {
    self.api = api
    self.isPreview = isPreview
    self.selectedPlace = initialPlace
    self.language =
      language ?? (Locale.current.language.languageCode?.identifier == "zh" ? "zh" : "en")
  }

  var mapPlaces: [PlacePresentation] {
    var markers = viewportMarkers
    if browse != nil { markers += results }
    var seen = Set<String>()
    var places = markers.map(presentation).filter { seen.insert($0.id).inserted }
    if let selectedPlace, detailState != .failed(.unavailable) {
      places.removeAll { $0.id == selectedPlace.id }
      places.append(selectedPlace)
    }
    return places
  }

  var resultPlaces: [PlacePresentation] { results.map(presentation) }

  func presentation(_ marker: Marker) -> PlacePresentation {
    let origin: GeoPoint?
    let located: Bool
    if case .nearby(_, let center, let fromLocation) = browse {
      origin = center
      located = fromLocation
    } else {
      origin = userLocation ?? viewport?.center
      located = userLocation != nil
    }
    return PlacePresentation(marker: marker, origin: origin, located: located, baseURL: api.baseURL)
  }

  func viewportChanged(_ viewport: MapViewport, debounce: Bool = true) {
    self.viewport = viewport
    guard !isPreview else { return }
    if let category = pendingNearby {
      pendingNearby = nil
      browse = .nearby(category: category, center: viewport.center, located: false)
      loadResults(.nearby(viewport.center, category))
    }
    viewportTask?.cancel()
    let generation = UUID()
    viewportGeneration = generation
    viewportState = .loading
    let language = language
    viewportTask = Task { [weak self, api] in
      do {
        if debounce { try await Task.sleep(for: .milliseconds(250)) }
        var markers: [Marker] = []
        for bounds in viewport.bounds {
          markers += try await api.markers(.viewport(bounds), language: language)
        }
        try Task.checkCancellation()
        guard let self, generation == self.viewportGeneration else { return }
        var seen = Set<Int64>()
        self.viewportMarkers = markers.filter { seen.insert($0.id).inserted }
        self.viewportState = .loaded
      } catch {
        guard !Task.isCancelled, let self, generation == self.viewportGeneration else { return }
        self.viewportMarkers = []
        self.viewportState = .failed(self.failureReason(error))
      }
    }
  }

  func search(_ text: String, debounce: Bool = true) {
    guard !isPreview else { return }
    let term = text.trimmingCharacters(in: .whitespacesAndNewlines)
    locationGeneration = UUID()
    pendingNearby = nil
    closeDetail()
    guard !term.isEmpty else {
      closeResults()
      return
    }
    browse = .search(term)
    loadResults(.search(term), debounce: debounce)
  }

  /// A Nearby origin is captured once, so dragging the map cannot move its results.
  @discardableResult
  func nearby(_ category: PlaceCategory) -> UUID {
    closeDetail()
    closeResults()
    let token = UUID()
    locationGeneration = token
    guard !isPreview else { return token }
    pendingNearby = category
    resultsState = .loading
    guard let center = viewport?.center else { return token }
    pendingNearby = nil
    browse = .nearby(category: category, center: center, located: false)
    loadResults(.nearby(center, category))
    return token
  }

  func resolveNearbyLocation(_ point: GeoPoint, token: UUID) {
    guard token == locationGeneration else { return }
    let category: PlaceCategory
    if case .nearby(let current, _, _) = browse {
      category = current
    } else if let pendingNearby {
      category = pendingNearby
    } else {
      return
    }
    pendingNearby = nil
    userLocation = point
    browse = .nearby(category: category, center: point, located: true)
    focus = MapFocus(point: point)
    loadResults(.nearby(point, category))
  }

  func beginLocationRequest() -> UUID {
    locationGeneration = UUID()
    return locationGeneration
  }

  func acceptsLocation(_ token: UUID) -> Bool { token == locationGeneration }

  func locate(_ point: GeoPoint, token: UUID) {
    guard acceptsLocation(token) else { return }
    userLocation = point
    focus = MapFocus(point: point)
  }

  func select(_ place: PlacePresentation) {
    locationGeneration = UUID()
    pendingNearby = nil
    selectedPlace = place
    detailTask?.cancel()
    detailState = .idle
    if let point = place.point { focus = MapFocus(point: point) }
    guard !isPreview, let id = Int64(place.id) else { return }
    loadDetail(id)
  }

  private func loadDetail(_ id: Int64) {
    detailTask?.cancel()
    let generation = UUID()
    detailGeneration = generation
    detailState = .loading
    let language = language
    detailTask = Task { [weak self, api] in
      do {
        let marker = try await api.detail(id: id, language: language)
        try Task.checkCancellation()
        guard let self, generation == self.detailGeneration else { return }
        self.selectedPlace = self.presentation(marker)
        self.detailState = .loaded
      } catch {
        guard !Task.isCancelled, let self, generation == self.detailGeneration else { return }
        let failure = self.failureReason(error)
        self.detailState = .failed(failure)
        if failure == .unavailable {
          // Cancel older list responses before removing a now-hidden marker.
          self.viewportTask?.cancel()
          self.browseTask?.cancel()
          self.viewportGeneration = UUID()
          self.browseGeneration = UUID()
          self.viewportMarkers.removeAll { $0.id == id }
          self.results.removeAll { $0.id == id }
          self.viewportState = .idle
          self.resultsState = .loaded
          // A same-region callback is deduplicated by MapKit. Restart these reads
          // explicitly so a 404 cannot strand the remaining public results.
          if let viewport = self.viewport { self.viewportChanged(viewport, debounce: false) }
          if self.browse != nil { self.retryResults() }
        }
      }
    }
  }

  func closeDetail() {
    detailGeneration = UUID()
    detailTask?.cancel()
    selectedPlace = nil
    detailState = .idle
  }

  func closeResults() {
    locationGeneration = UUID()
    browseGeneration = UUID()
    browseTask?.cancel()
    browse = nil
    pendingNearby = nil
    results = []
    resultsState = .idle
  }

  func retryResults() {
    switch browse {
    case .search(let term): loadResults(.search(term))
    case .nearby(let category, let center, _): loadResults(.nearby(center, category))
    case nil: if let viewport { viewportChanged(viewport, debounce: false) }
    }
  }

  func retryDetail() {
    if let id = selectedPlace.flatMap({ Int64($0.id) }) { loadDetail(id) }
  }

  func stop() {
    viewportTask?.cancel()
    browseTask?.cancel()
    detailTask?.cancel()
    locationGeneration = UUID()
  }

  private func failureReason(_ error: any Error) -> PlaceFailure {
    let response = error as? MarkerRequestFailure
    lastRequestID = response?.requestID
    return response?.failure ?? error as? PlaceFailure ?? .requestFailed
  }

  private func loadResults(_ query: MarkerQuery, debounce: Bool = false) {
    browseTask?.cancel()
    let generation = UUID()
    browseGeneration = generation
    results = []
    resultsState = .loading
    let language = language
    browseTask = Task { [weak self, api] in
      do {
        if debounce { try await Task.sleep(for: .milliseconds(300)) }
        let markers = try await api.markers(query, language: language)
        try Task.checkCancellation()
        guard let self, generation == self.browseGeneration else { return }
        self.results = markers
        self.resultsState = .loaded
      } catch {
        guard !Task.isCancelled, let self, generation == self.browseGeneration else { return }
        self.resultsState = .failed(self.failureReason(error))
      }
    }
  }
}
