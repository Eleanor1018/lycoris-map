import Foundation
import MapKit
import Testing

@testable import Lycoris

@MainActor struct PreferencesAndLinkTests {
  @Test func preferencesPersistAndRejectOutOfRangeValues() throws {
    let name = "lycoris-tests-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    defer { defaults.removePersistentDomain(forName: name) }
    let preferences = AppPreferences(defaults: defaults)
    #expect(preferences.radius == 1000)
    preferences.language = .chinese
    preferences.mapAppearance = .satellite
    #expect(preferences.setRadius(2500))
    #expect(!preferences.setRadius(0))
    #expect(!preferences.setRadius(50_001))
    let restored = AppPreferences(defaults: defaults)
    #expect(restored.language == .chinese && restored.radius == 2500)
    #expect(restored.mapAppearance == .satellite)
    defaults.set(-1, forKey: "lycoris.radius")
    defaults.set("unknown", forKey: "lycoris.language")
    defaults.set("unknown", forKey: "lycoris.mapAppearance")
    #expect(AppPreferences(defaults: defaults).radius == 1000)
    #expect(AppPreferences(defaults: defaults).mapAppearance == .explore)
  }

  @Test func derivedStringsUseSelectedBundle() {
    #expect(String(appLocalized: "Hours not provided", language: .english) == "Hours not provided")
    #expect(String(appLocalized: "Hours not provided", language: .chinese) != "Hours not provided")
    #expect(String(appLocalized: "Searching Range", language: .chinese) == "搜索范围")
  }

  @Test func radiusAndLanguageReachTheActualRequest() throws {
    let api = MarkerAPI(baseURL: URL(string: "https://example.test"))
    let point = try #require(GeoPoint(latitude: 31, longitude: 121))
    let request = try api.request(for: .nearby(point, .nursing, radius: 2500), language: "zh")
    let items = try #require(
      URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems)
    #expect(items.contains(URLQueryItem(name: "radius", value: "2500")))
    #expect(items.contains(URLQueryItem(name: "lang", value: "zh")))
    #expect(throws: PlaceFailure.invalidResponse) {
      try api.request(for: .nearby(point, .nursing, radius: 50_001), language: "en")
    }
  }

  @Test func linksRejectAmbiguousOrUntrustedRoutesWithoutLosingInt64Precision() throws {
    let id = Int64.max
    let url = try #require(PlaceLink.url(id: id))
    #expect(PlaceLink(url: url)?.id == id)
    // Optional Web-compatible language is accepted; the recipient's preference wins.
    #expect(PlaceLink(url: URL(string: "lycoris://maps?markerId=7&lang=zh")!)?.id == 7)
    for raw in [
      "https://unknown.test/maps?markerId=7", "lycoris://maps?markerId=0",
      "lycoris://maps?markerId=-1", "lycoris://maps?markerId=01",
      "lycoris://maps?markerId=1&markerId=2", "lycoris://maps?markerId=9223372036854775808",
      "lycoris://user@maps?markerId=1", "lycoris://maps:80?markerId=1",
      "lycoris://maps/other?markerId=1", "lycoris://maps?markerId=1#hidden",
      "lycoris://maps?markerId=1&lang=fr", "lycoris://maps?markerId=1&token=secret",
    ] { #expect(PlaceLink(url: URL(string: raw)!) == nil) }
  }

  @Test func changingRadiusDiscardsOldResultsAndPreservesCapturedCenter() async throws {
    let api = DeferredMarkers()
    let store = PlaceStore(api: api, language: "en")
    let token = store.nearby(.nursing)
    let center = GeoPoint(latitude: 31, longitude: 121)!
    store.resolveNearbyLocation(center, token: token)
    try await waitFor { await api.count() == 1 }
    let focus = store.focus
    store.updatePreferences(language: "en", radius: 2500)
    try await waitFor { await api.count() == 2 }
    #expect(await api.requests.last == .list(.nearby(center, .nursing, radius: 2500)))
    await api.finish(1, .success([sampleMarker(2)]))
    try await waitFor { store.resultsState == .loaded }
    await api.finish(0, .success([sampleMarker(1)]))
    await Task.yield()
    #expect(store.results.map(\.id) == [2])
    #expect(store.focus == focus)
    store.stop()
  }

  @Test func languageChangeCannotReselectPreviousDetail() async throws {
    let api = DeferredMarkers()
    let store = PlaceStore(api: api, language: "en")
    store.select(store.presentation(sampleMarker(1)))
    try await waitFor { await api.count() == 1 }
    await api.finish(0, .success([sampleMarker(1)]))
    try await waitFor { store.detailState == .loaded }
    store.select(store.presentation(sampleMarker(2)))
    try await waitFor { await api.count() == 2 }
    let focus = store.focus
    store.updatePreferences(language: "zh", radius: 1000)
    try await waitFor { await api.count() == 3 }
    #expect(await api.requests.last == .detail(2))
    await api.finish(2, .success([sampleMarker(2)]))
    try await waitFor { store.detailState == .loaded }
    await api.finish(1, .success([sampleMarker(1)]))
    await Task.yield()
    #expect(store.selectedPlace?.id == "2")
    #expect(store.focus == focus)
    store.stop()
  }

  @Test func revokingLocationInvalidatesPendingFixAndClearsDistanceOrigin() async throws {
    let api = DeferredMarkers()
    let store = PlaceStore(api: api)
    let token = store.beginLocationRequest()
    store.locate(GeoPoint(latitude: 31, longitude: 121)!, token: token)
    store.revokeLocation()
    store.locate(GeoPoint(latitude: 40, longitude: 50)!, token: token)
    #expect(store.userLocation == nil)
    #expect(!store.acceptsLocation(token))
    #expect(store.presentation(sampleMarker(1)).distanceReference == nil)
    store.stop()
  }

  private func waitFor(_ condition: () async -> Bool) async throws {
    for _ in 0..<200 {
      if await condition() { return }
      try await Task.sleep(for: .milliseconds(5))
    }
    Issue.record("Timed out waiting for request/state")
  }
}
