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

@MainActor @Observable
final class AppPreferences {
  private let defaults: UserDefaults
  var language: AppLanguage {
    didSet { defaults.set(language.rawValue, forKey: "lycoris.language") }
  }
  private(set) var radius: Int

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    language = .current(in: defaults)
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
