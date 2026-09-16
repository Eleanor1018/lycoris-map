import SwiftUI

struct MapPanelContent: View {
  @Environment(\.locale) private var locale
  let cardHeight: CGFloat
  let showsSettings: Bool
  let bookmarks: [PlacePresentation]
  var onCategory: (PlaceCategory) -> Void = { _ in }
  let onSelect: (PlacePresentation) -> Void
  let onUnavailableAction: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("Find Nearby").font(.title3.weight(.semibold))
        .padding(.horizontal, 6).padding(.bottom, 8)
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
      if showsSettings {
        if !bookmarks.isEmpty {
          sectionHeading("Bookmarks")
            .accessibilityIdentifier("map.bookmarks.heading")
          VStack(spacing: 0) {
            ForEach(bookmarks) { place in
              PlaceRow(place: place) { onSelect(place) }
            }
          }
          .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 24))
          .padding(.horizontal, 3)
        }
        sectionHeading("Settings")
        VStack(spacing: 6) {
          settingsRow(
            "Choose Language",
            value: locale.language.languageCode?.identifier == "zh" ? "简体中文" : "English")
          settingsRow("Searching Range", value: "1km")
          settingsRow("Map Source", value: "Apple Maps")
          settingsRow("About Lycoris Maps", value: "")
        }
        .padding(.horizontal, 3).padding(.top, 6)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func sectionHeading(_ title: LocalizedStringKey) -> some View {
    Button(action: onUnavailableAction) {
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

  private func settingsRow(_ title: LocalizedStringKey, value: String) -> some View {
    Button(action: onUnavailableAction) {
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
  }
}
