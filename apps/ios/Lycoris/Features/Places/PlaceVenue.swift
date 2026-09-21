import Foundation

/// The eight controlled venue types served for accessible toilets. Unknown or
/// missing server strings are deliberately not mapped here, so an unknown raw
/// value never displays an invented "Other" tag.
enum PlaceVenue: String, Codable, CaseIterable, Sendable, Identifiable {
  case metro
  case hospital
  case mall
  case railwayStation = "railway_station"
  case school
  case publicToilet = "public_toilet"
  case airport
  case other

  var id: String { rawValue }

  /// SF Symbol for the native venue tag. Uses only system assets.
  var symbol: String {
    switch self {
    case .metro: "tram.fill"
    case .hospital: "cross.case.fill"
    case .mall: "bag.fill"
    case .railwayStation: "train.side.front.car"
    case .school: "graduationcap.fill"
    case .publicToilet: "toilet.fill"
    case .airport: "airplane"
    case .other: "mappin.and.ellipse"
    }
  }

  func title(language: AppLanguage) -> String {
    String(appLocalized: titleKey, language: language, table: "PlaceMetadata")
  }

  private var titleKey: String.LocalizationValue {
    switch self {
    case .metro: "Metro"
    case .hospital: "Hospital"
    case .mall: "Mall"
    case .railwayStation: "Railway station"
    case .school: "School"
    case .publicToilet: "Public toilet"
    case .airport: "Airport"
    case .other: "Other"
    }
  }
}
