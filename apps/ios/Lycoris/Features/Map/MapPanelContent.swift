import SwiftUI

struct MapPanelContent: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  var preferences: AppPreferences
  var onSettings: (SettingsDestination) -> Void
  let cardHeight: CGFloat
  let showsSettings: Bool
  let bookmarks: [PlacePresentation]
  var showsBookmarks = false
  var bookmarksLoading = false
  var bookmarksMessage: String? = nil
  var onBookmarks: () -> Void = {}
  var onCategory: (PlaceCategory) -> Void = { _ in }
  let onSelect: (PlacePresentation) -> Void
  let onUnavailableAction: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("Find Nearby").font(.title3.weight(.semibold))
        .padding(.horizontal, 6).padding(.bottom, 8).accessibilityAddTraits(.isHeader)
      if dynamicTypeSize.isAccessibilitySize {
        VStack(spacing: 12) {
          category(.toilet)
          category(.nursing)
          category(.medical)
        }
      } else {
        Grid(horizontalSpacing: 16, verticalSpacing: 12) {
          GridRow {
            category(.toilet)
            category(.nursing)
          }
          GridRow {
            category(.medical)
            Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
          }
        }
      }
      if showsSettings {
        if showsBookmarks || !bookmarks.isEmpty {
          sectionHeading("Bookmarks", action: onBookmarks)
            .accessibilityIdentifier("map.bookmarks.heading")
          VStack(spacing: 0) {
            ForEach(bookmarks.prefix(3)) { place in
              PlaceRow(place: place) { onSelect(place) }
            }
          }
          .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 24))
          .padding(.horizontal, 3)
          if bookmarks.isEmpty {
            if bookmarksLoading {
              ProgressView().padding(8)
            } else {
              Text(bookmarksMessage ?? String(appLocalized: "No bookmarks yet."))
                .font(.subheadline).foregroundStyle(.secondary)
                .padding(.horizontal, 6).padding(.vertical, 8)
            }
          }
        }
        Text("Settings").font(.title3.weight(.semibold))
          .frame(minHeight: 44).padding(.horizontal, 6).accessibilityAddTraits(.isHeader)
        VStack(spacing: 6) {
          settingsRow("Choose Language", value: preferences.language.name, destination: .language)
          settingsRow(
            "Searching Range", value: AppPreferences.radiusLabel(preferences.radius),
            destination: .range)
          settingsRow("Map Source", value: String(appLocalized: "Apple Maps"), destination: .source)
          settingsRow("About Lycoris Maps", value: "", destination: .about)
        }
        .padding(.horizontal, 3).padding(.top, 6)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func sectionHeading(_ title: LocalizedStringKey, action: (() -> Void)? = nil) -> some View
  {
    Button(action: action ?? onUnavailableAction) {
      HStack {
        Text(title).font(.title3.weight(.semibold))
        Spacer()
        Image(systemName: "chevron.right").font(.body.weight(.semibold))
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 6).frame(minHeight: 44)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func category(_ category: PlaceCategory) -> some View {
    Button {
      onCategory(category)
    } label: {
      HStack(spacing: 12) {
        CategoryIcon(image: category.image, tint: category.tint)
        Text(category.title).font(.body.weight(.semibold))
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(.horizontal, 16).padding(.vertical, 10)
      .frame(maxWidth: .infinity, minHeight: cardHeight)
      .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 24))
      .contentShape(RoundedRectangle(cornerRadius: 24))
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("map.category.\(category.rawValue)")
  }

  private func settingsRow(
    _ title: LocalizedStringKey, value: String, destination: SettingsDestination
  ) -> some View {
    Button {
      onSettings(destination)
    } label: {
      HStack {
        Text(title)
        Spacer(minLength: 8)
        Text(value).foregroundStyle(.secondary)
        Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
          .foregroundStyle(Color.accentColor).accessibilityHidden(true)
      }
      .font(.body).padding(.horizontal, 17).padding(.vertical, 10)
      .frame(minHeight: cardHeight)
      .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 24))
      .contentShape(RoundedRectangle(cornerRadius: 24))
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("settings.\(destination.rawValue)")
  }
}
