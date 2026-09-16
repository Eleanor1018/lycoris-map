#if DEBUG
  import SwiftUI

  /// Explicit design fixtures. They never represent an authenticated session.
  enum MapPreviewScenario: String, CaseIterable {
    case collapsed, nearby, expanded, anonymousExpanded, details

    static var launchSelection: Self {
      let arguments = ProcessInfo.processInfo.arguments
      guard let index = arguments.firstIndex(of: "-lycoris-preview"),
        arguments.indices.contains(index + 1)
      else { return .collapsed }
      return Self(rawValue: arguments[index + 1]) ?? .collapsed
    }

    static let places = (1...3).map { index in
      PlacePresentation(
        id: "figma-preview-\(index)", title: "600, South Wanping Road.",
        detailTitle: "600, Wanping South Road no1\nAccessable Toilet",
        distance: "1.1km", openingHours: "09:00-21:00",
        description:
          "Sip handcrafted cocktails and enjoy waterfront views at NYC's favorite floating restaurant.",
        photoAsset: "PreviewPlacePhoto", latitude: 40.785, longitude: -74.077)
    }
  }

  extension MapScreen {
    init(preview: MapPreviewScenario) {
      self.init(
        initialDetent: preview == .collapsed
          ? .collapsed
          : preview == .nearby || preview == .details ? .nearby : .expanded,
        bookmarks: preview == .expanded ? MapPreviewScenario.places : [],
        initialPlace: preview == .details ? MapPreviewScenario.places[0] : nil)
    }
  }

  #Preview("1 · Collapsed") { MapScreen(preview: .collapsed) }
  #Preview("2 · Nearby") { MapScreen(preview: .nearby) }
  #Preview("3 · Bookmarks preview") { MapScreen(preview: .expanded) }
  #Preview("3 · Anonymous") { MapScreen(preview: .anonymousExpanded) }
  #Preview("4 · Place details") { MapScreen(preview: .details) }
#endif
