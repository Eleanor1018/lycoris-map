import SwiftUI

struct MapPanelContent: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  var preferences: AppPreferences
  var onSettings: (SettingsDestination) -> Void
  let cardHeight: CGFloat
  let showsSettings: Bool
  var bottomInset: CGFloat = 0
  var viewportState: PlaceStore.LoadState = .idle
  var onRetry: () -> Void = {}
  let bookmarks: [PlacePresentation]
  var showsBookmarks = false
  var bookmarksLoading = false
  var bookmarksMessage: String? = nil
  var onBookmarks: () -> Void = {}
  var onCategory: (PlaceCategory) -> Void = { _ in }
  let onSelect: (PlacePresentation) -> Void
  let onUnavailableAction: () -> Void

  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 8) {
          if case .failed = viewportState {
            PlaceLoadStatus(state: viewportState, retry: onRetry)
          }
          nearbyCategories
        }
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
      }
      if showsSettings {
        if showsBookmarks || !bookmarks.isEmpty {
          Section {
            bookmarkPreview
              .listRowInsets(EdgeInsets())
              .listRowBackground(Color.clear)
              .listRowSeparator(.hidden)
          }
        }
        Section {
          settingsRow("Choose Language", value: preferences.language.name, destination: .language)
          settingsRow(
            "Search Type", value: preferences.searchType.title(language: preferences.language),
            destination: .searchType)
          settingsRow(
            "Searching Range", value: AppPreferences.radiusLabel(preferences.radius),
            destination: .range)
          settingsRow("Map Source", value: String(appLocalized: "Apple Maps"), destination: .source)
          settingsRow("About Lycoris Maps", value: "", destination: .about)
        } header: {
          Text("Settings").font(.title3.weight(.semibold)).textCase(nil)
            .accessibilityAddTraits(.isHeader)
            .listRowInsets(EdgeInsets(top: 0, leading: 6, bottom: 0, trailing: 6))
        }
      }
    }
    .listStyle(.insetGrouped)
    .listSectionSpacing(8)
    .environment(\.defaultMinListRowHeight, 44)
    .scrollContentBackground(.hidden)
    .contentMargins(.top, 0, for: .scrollContent)
    .contentMargins(.horizontal, 17, for: .scrollContent)
    .contentMargins(.bottom, bottomInset, for: .scrollContent)
    .accessibilityIdentifier("map.panel.content")
  }

  private var nearbyCategories: some View {
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
    }
  }

  private var bookmarkPreview: some View {
    VStack(alignment: .leading, spacing: 0) {
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
        if dynamicTypeSize.isAccessibilitySize {
          VStack(alignment: .leading, spacing: 4) {
            Text(title)
            if !value.isEmpty { Text(value).foregroundStyle(.secondary) }
          }
          .fixedSize(horizontal: false, vertical: true).padding(.vertical, 8)
          Spacer(minLength: 8)
        } else {
          LabeledContent(title) {
            Text(value).foregroundStyle(.secondary)
          }
        }
        Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
          .foregroundStyle(.tertiary).accessibilityHidden(true)
      }
      .font(.body).foregroundStyle(.primary).frame(minHeight: 44)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
    .accessibilityElement(children: .ignore)
    .accessibilityAddTraits(.isButton)
    .accessibilityLabel(title)
    .accessibilityValue(value)
    .accessibilityIdentifier("settings.\(destination.rawValue)")
  }
}
