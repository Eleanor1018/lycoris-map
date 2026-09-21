import SwiftUI

extension EnvironmentValues {
  /// The app's selected language. Views read this instead of the system locale so
  /// accessibility labels update immediately after the in-app language change.
  @Entry var lycorisAppLanguage: AppLanguage = .current()
}

/// Central accessibility text for a place row or map pin. Kept separate from
/// `PlacePresentation` so the same localized category/metadata phrasing is used
/// by every surface without changing the API data format.
enum PlaceAccessibility {
  /// The localized name of a category, using the app's selected language rather
  /// than the system language. Unknown/empty categories fall back to "Places".
  static func categoryLabel(_ category: PlaceCategory, language: AppLanguage) -> String {
    let key: String.LocalizationValue
    switch category {
    case .toilet: key = "Accessible Toilets"
    case .nursing: key = "Nursing Rooms"
    case .medical: key = "Medical Institutions"
    case .other: key = "Places"
    }
    return String(appLocalized: key, language: language)
  }

  /// A nonvisual, natural description of the distance. The visual short value is
  /// retained, but a screen reader hears a spoken form ("about 230 meters").
  static func distanceDescription(_ distance: String, language: AppLanguage) -> String? {
    let trimmed = distance.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    if trimmed.lowercased().hasSuffix("km") {
      let number = String(trimmed.dropLast(2))
      guard !number.isEmpty else { return distance }
      return String(
        format: String(
          appLocalized: "%@ kilometers away", language: language, table: "Accessibility"), number)
    }
    if trimmed.lowercased().hasSuffix("m") {
      let number = String(trimmed.dropLast())
      guard !number.isEmpty else { return distance }
      return String(
        format: String(appLocalized: "%@ meters away", language: language, table: "Accessibility"),
        number)
    }
    return distance
  }

  /// The complete spoken label for a place row/pin: category, name, venue,
  /// distance and hours, without repeating the decorative category icon or
  /// doubling synonymous status phrases. The venue tag is only spoken when a
  /// known venue exists, and the opening status is only spoken when it is a
  /// real `open`/`closed`/`closing-soon` value.
  static func placeLabel(
    _ place: PlacePresentation, language: AppLanguage, now: Date = .now
  ) -> String {
    var parts = [
      categoryLabel(place.category, language: language),
      place.title,
    ]
    if let venue = place.venue {
      parts.append(venue.title(language: language))
    }
    if let distance = distanceDescription(place.distance, language: language) {
      parts.append(distance)
    }
    let hours = place.openingHours.trimmingCharacters(in: .whitespacesAndNewlines)
    if !hours.isEmpty { parts.append(hours) }
    let status = place.openingStatus(at: now).label(language: language)
    if !status.isEmpty { parts.append(status) }
    return parts.joined(separator: ", ")
  }
}
