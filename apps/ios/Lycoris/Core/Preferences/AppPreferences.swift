import Foundation
import Observation

enum AppLanguage: String, CaseIterable, Identifiable, Sendable {
  case english = "en"
  case chinese = "zh"
  var id: String { rawValue }
  var name: String { self == .chinese ? "简体中文" : "English" }
  var locale: Locale { Locale(identifier: self == .chinese ? "zh-Hans" : "en") }
  static func current(in defaults: UserDefaults = .standard) -> Self {
    defaults.string(forKey: "lycoris.language").flatMap(Self.init(rawValue:))
      ?? (Locale.current.language.languageCode?.identifier == "zh" ? .chinese : .english)
  }
}

enum SearchType: String, CaseIterable, Identifiable, Sendable {
  case all, toilet, nursing, medical
  var id: String { rawValue }
  var category: PlaceCategory? {
    switch self {
    case .all: nil
    case .toilet: .toilet
    case .nursing: .nursing
    case .medical: .medical
    }
  }
  func title(language: AppLanguage) -> String {
    switch self {
    case .all: String(appLocalized: "All", language: language)
    case .toilet: String(appLocalized: "Accessible Toilets", language: language)
    case .nursing: String(appLocalized: "Nursing Rooms", language: language)
    case .medical: String(appLocalized: "Medical Institutions", language: language)
    }
  }
}

@MainActor @Observable
final class AppPreferences {
  private let defaults: UserDefaults
  var language: AppLanguage {
    didSet { defaults.set(language.rawValue, forKey: "lycoris.language") }
  }
  private(set) var radius: Int
  var searchType: SearchType {
    didSet { defaults.set(searchType.rawValue, forKey: "lycoris.searchType") }
  }
  var mapAppearance: MapAppearance {
    didSet { defaults.set(mapAppearance.rawValue, forKey: "lycoris.mapAppearance") }
  }

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    language = .current(in: defaults)
    searchType =
      defaults.string(forKey: "lycoris.searchType")
      .flatMap(SearchType.init(rawValue:)) ?? .all
    mapAppearance =
      defaults.string(forKey: "lycoris.mapAppearance")
      .flatMap(MapAppearance.init(rawValue:)) ?? .explore
    let saved = defaults.integer(forKey: "lycoris.radius")
    radius = Self.validRadius(saved) ? saved : 1000
  }

  static func validRadius(_ value: Int) -> Bool { (1...50_000).contains(value) }
  @discardableResult func setRadius(_ value: Int) -> Bool {
    guard Self.validRadius(value) else { return false }
    radius = value
    defaults.set(value, forKey: "lycoris.radius")
    return true
  }
  static func radiusLabel(_ value: Int) -> String {
    if value < 1000 { return "\(value)m" }
    return "\(Double(value) / 1000)km".replacingOccurrences(of: ".0km", with: "km")
  }
}

extension String {
  /// Also localizes model-generated text; SwiftUI's environment alone cannot do that.
  init(appLocalized key: String.LocalizationValue, language: AppLanguage = .current()) {
    let bundle =
      Bundle.main.path(forResource: language.locale.identifier, ofType: "lproj")
      .flatMap(Bundle.init(path:)) ?? .main
    self.init(localized: key, bundle: bundle, locale: language.locale)
  }
}
