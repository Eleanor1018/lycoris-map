import Foundation

/// Display values shared by rows and details; API DTOs arrive in I3.
struct PlacePresentation: Identifiable, Equatable, Sendable {
  let id: String
  let title: String
  let detailTitle: String
  let distance: String
  let openingHours: String
  let description: String
  let photoAsset: String
  let latitude: Double
  let longitude: Double
}
