import SwiftUI

struct SettingsHomeSheet: View {
  let preferences: AppPreferences
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Form {
        row("Choose Language", value: preferences.language.name, destination: .language)
        row("Search Type", value: preferences.searchType.title(language: preferences.language),
            destination: .searchType)
        row("Searching Range", value: AppPreferences.radiusLabel(preferences.radius), destination: .range)
        row("Map Source", value: String(appLocalized: "Apple Maps"), destination: .source)
        row("About Lycoris Maps", value: "", destination: .about)
      }
      .accessibilityIdentifier("settings.home.form")
      .environment(\.defaultMinListRowHeight, 44)
      .navigationTitle("Settings").navigationBarTitleDisplayMode(.inline)
      .navigationDestination(for: SettingsDestination.self) { destination in
        SettingsSheet(preferences: preferences, destination: destination, embedsNavigation: false)
      }
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Done") { dismiss() }.accessibilityIdentifier("settings.home.done")
        }
      }
    }
    .presentationDragIndicator(.visible)
  }

  private func row(_ title: LocalizedStringKey, value: String, destination: SettingsDestination) -> some View {
    NavigationLink(value: destination) {
      LabeledContent(title, value: value)
    }.accessibilityIdentifier("settings.\(destination.rawValue)")
  }
}
