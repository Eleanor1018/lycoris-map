import MapKit
import SwiftUI

enum MapAppearance: String, CaseIterable, Identifiable, Sendable {
  case explore, satellite
  var id: String { rawValue }

  var title: LocalizedStringKey {
    switch self {
    case .explore: "Explore"
    case .satellite: "Satellite"
    }
  }

  var symbol: String {
    switch self {
    case .explore: "map"
    case .satellite: "globe.americas"
    }
  }

  func configuration() -> MKMapConfiguration {
    switch self {
    case .explore:
      return MKStandardMapConfiguration(elevationStyle: .flat)
    case .satellite:
      return MKHybridMapConfiguration(elevationStyle: .flat)
    }
  }
}
