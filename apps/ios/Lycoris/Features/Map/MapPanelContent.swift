import SwiftUI

/// I1 layout content; data flows and destinations arrive in I2–I6.
struct MapPanelContent: View {
  @Environment(\.locale) private var locale
  let cardHeight: CGFloat
  let showsSettings: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Find Nearby").font(.title3.weight(.semibold)).padding(.horizontal, 6)
      Grid(horizontalSpacing: 16, verticalSpacing: 12) {
        GridRow {
          category("Accessible Toilets", image: "Toilet", tint: "ToiletTint")
          category("Nursing Rooms", image: "Nursing", tint: "NursingTint")
        }
        GridRow {
          category("Medical Institutions", image: "Medical", tint: "MedicalTint")
          Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
        }
      }
      if showsSettings {
        Text("Settings").font(.title3.weight(.semibold))
          .padding(.horizontal, 6).padding(.top, 8)
        settingsRow(
          "Choose Language",
          value: locale.language.languageCode?.identifier == "zh" ? "简体中文" : "English")
        settingsRow("Searching Range", value: "1 km")
        settingsRow("Map Source", value: "Apple Maps")
        settingsRow("About Lycoris Maps", value: "")
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func category(_ title: LocalizedStringKey, image: String, tint: String) -> some View {
    HStack(spacing: 12) {
      Image(image).resizable().frame(width: 24, height: 24)
        .frame(width: 30, height: 30)
        .background(Color(tint), in: Circle()).accessibilityHidden(true)
      Text(title).font(.body.weight(.semibold))
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, 16)
    .frame(maxWidth: .infinity, minHeight: cardHeight)
    .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 24))
  }

  private func settingsRow(_ title: LocalizedStringKey, value: String) -> some View {
    HStack {
      Text(title)
      Spacer(minLength: 8)
      Text(value).foregroundStyle(.secondary)
      Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
        .foregroundStyle(Color.accentColor).accessibilityHidden(true)
    }
    .font(.body).padding(.horizontal, 17)
    .frame(minHeight: cardHeight)
    .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 24))
  }
}
