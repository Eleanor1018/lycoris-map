import Foundation
import SwiftUI

/// Mirrors `reference/openingStatus.ts` exactly, including the day/overnight
/// window, the equal-time (24h) rule and the IANA daylight-saving local clock.
///
/// Real-time status is only derived from the server-provided `hoursTimezone`;
/// the viewer's device time zone is never used to infer a distant place.
enum OpeningStatus: String, Equatable, Sendable {
  case unknown
  case scheduled
  case open
  case closed
  case closingSoon = "closing-soon"

  /// A short status phrase that never relies on color alone and never collapses
  /// `open` and `closing-soon` into one label. Empty for `unknown`/`scheduled`.
  func label(language: AppLanguage) -> String {
    switch self {
    case .open:
      String(appLocalized: "Open now", language: language, table: "PlaceMetadata")
    case .closingSoon:
      String(appLocalized: "Closing soon", language: language, table: "PlaceMetadata")
    case .closed:
      String(appLocalized: "Closed now", language: language, table: "PlaceMetadata")
    case .unknown, .scheduled:
      ""
    }
  }

  /// `unknown` stays fully neutral. `scheduled` is not a live state, but its
  /// valid planned time is still emphasized with the accent tint. `open`,
  /// `closing-soon` and `closed` use distinct status colors.
  var usesStatusColor: Bool {
    switch self {
    case .open, .closingSoon, .closed, .scheduled: true
    case .unknown: false
    }
  }

  var color: Color {
    switch self {
    case .open: .green
    case .closingSoon: .orange
    case .closed: .red
    case .scheduled: .accentColor
    case .unknown: .secondary
    }
  }

  /// A small supplementary glyph next to the status text; the words always
  /// carry the meaning so color and icon are never the only distinction.
  var symbolName: String {
    switch self {
    case .open: "checkmark.circle.fill"
    case .closingSoon: "clock.badge.exclamationmark"
    case .closed: "moon.zzz.fill"
    case .scheduled, .unknown: "clock"
    }
  }
}

enum OpeningStatusEngine {
  private static let secondsPerDay = 86_400

  /// A legal `HH:mm` value, matching the shared backend/web contract. ASCII-only
  /// digits: unlike JavaScript's digit class (ASCII-only), Swift's regex digit
  /// class matches Unicode digits, which would let `0١:0١` masquerade as equal
  /// valid times and be misread as all-day open. The pattern is built per call
  /// because `Regex` is not `Sendable` and must not be shared mutable state.
  static func isValidTime(_ value: String) -> Bool {
    value.wholeMatch(of: /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/) != nil
  }

  static func seconds(_ time: String) -> Int? {
    let parts = time.split(separator: ":")
    guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else { return nil }
    return hour * 3_600 + minute * 60
  }

  /// Same daily/overnight and equal-time (24h) semantics as the Rust API and web.
  static func status(start: String?, end: String?, timeZone: String?, now: Date) -> OpeningStatus {
    guard let start, let end, isValidTime(start), isValidTime(end) else { return .unknown }
    if start == end { return .open }
    // An invalid instant cannot be placed on any local clock, so an otherwise
    // valid schedule is only "scheduled", never open or closed.
    guard now.timeIntervalSinceReferenceDate.isFinite else { return .scheduled }
    // Never use the viewer's time zone to infer a distant place's availability.
    guard let timeZone, !timeZone.isEmpty, let zone = TimeZone(identifier: timeZone) else {
      return .scheduled
    }
    guard let current = localSeconds(in: zone, at: now) else { return .scheduled }
    guard let from = seconds(start), let to = seconds(end) else { return .unknown }
    let open = from < to ? current >= from && current < to : current >= from || current < to
    if !open { return .closed }
    let remaining = (to - current + secondsPerDay) % secondsPerDay
    return remaining > 0 && remaining <= 30 * 60 ? .closingSoon : .open
  }

  /// Reads the wall-clock time in the IANA zone through the platform calendar,
  /// so daylight-saving transitions follow the zone's real local clock.
  private static func localSeconds(in zone: TimeZone, at now: Date) -> Int? {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let parts = calendar.dateComponents([.hour, .minute, .second], from: now)
    guard let hour = parts.hour, let minute = parts.minute, let second = parts.second else {
      return nil
    }
    return hour * 3_600 + minute * 60 + second
  }
}
