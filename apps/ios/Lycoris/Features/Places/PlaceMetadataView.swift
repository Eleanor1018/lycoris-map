import SwiftUI

extension EnvironmentValues {
  /// A single shared "now" for every place's real-time status. `MapScreen` owns
  /// the one timer and publishes this value, so rows/details/sheets never each
  /// start their own clock. Defaults to the view's current time for previews.
  @Entry var lycorisMetadataNow: Date = .now
}

/// The restrained native venue tag: an SF Symbol plus localized text on a
/// subtle capsule. Hidden entirely when the server value is missing or unknown,
/// so no invented "Other" tag is ever shown.
struct PlaceVenueTag: View {
  @Environment(\.lycorisAppLanguage) private var appLanguage
  let venue: PlaceVenue

  var body: some View {
    Label(venue.title(language: appLanguage), systemImage: venue.symbol)
      .font(.caption.weight(.medium))
      .labelStyle(VenueTagLabelStyle())
      .foregroundStyle(.primary)
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(Color(.secondarySystemFill), in: Capsule())
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(venue.title(language: appLanguage))
      .accessibilityIdentifier("place.venue")
  }
}

/// Use each symbol's natural width instead of List's reserved row-icon column.
private struct VenueTagLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon
      configuration.title
    }
  }
}

/// The deliberately non-color-only opening-hours line. A valid schedule always
/// gets a light status-tinted container so the planned time itself is
/// highlighted even when `scheduled` has no status words or the detail screen
/// suppresses the closing-soon words; `unknown` stays fully neutral. Text is
/// primary, and the layout stacks vertically at accessibility sizes so the time
/// and a long status never squeeze each other.
struct PlaceOpeningHoursView: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.lycorisAppLanguage) private var appLanguage
  @Environment(\.lycorisMetadataNow) private var now
  let place: PlacePresentation
  var suppressesClosingSoonText = false

  private var status: OpeningStatus { place.openingStatus(at: now) }

  var body: some View {
    let label =
      status == .closingSoon && suppressesClosingSoonText
      ? "" : status.label(language: appLanguage)
    let layout =
      dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 3))
      : AnyLayout(HStackLayout(spacing: 6))
    layout {
      Text(place.openingHours)
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.primary)
        .fixedSize(horizontal: false, vertical: true)
      if !label.isEmpty {
        HStack(spacing: 4) {
          Image(systemName: status.symbolName).foregroundStyle(status.color)
          Text(label).foregroundStyle(.primary)
        }
        .font(.caption.weight(.medium))
      }
    }
    .padding(.horizontal, status == .unknown ? 0 : 8)
    .padding(.vertical, status == .unknown ? 0 : 3)
    .background(
      status == .unknown ? Color.clear : status.color.opacity(0.14),
      in: RoundedRectangle(cornerRadius: 8)
    )
    .fixedSize(horizontal: false, vertical: true)
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("place.hours")
  }
}

/// A short, explicit reminder shown only on the detail screen when a place is
/// about to close. Primary text on a light orange capsule keeps the contrast
/// adequate; the orange clock icon and tint are supplementary to the words.
struct PlaceClosingSoonTag: View {
  @Environment(\.lycorisAppLanguage) private var appLanguage
  @Environment(\.lycorisMetadataNow) private var now
  let place: PlacePresentation

  var body: some View {
    if place.openingStatus(at: now) == .closingSoon {
      Label {
        Text(
          String(
            appLocalized: "Closing soon", language: appLanguage, table: "PlaceMetadata")
        ).foregroundStyle(.primary)
      } icon: {
        Image(systemName: "clock.badge.exclamationmark").foregroundStyle(.orange)
      }
      .font(.caption.weight(.semibold))
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(Color.orange.opacity(0.14), in: Capsule())
      .accessibilityLabel(
        String(
          appLocalized: "Closing soon", language: appLanguage, table: "PlaceMetadata"))
      .accessibilityIdentifier("place.closing-soon")
    }
  }
}
