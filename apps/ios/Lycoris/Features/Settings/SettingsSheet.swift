import SwiftUI

enum SettingsDestination: String, Identifiable {
  case language, searchType, range, source, about
  var id: String { rawValue }
}

struct SettingsSheet: View {
  @Bindable var preferences: AppPreferences
  let destination: SettingsDestination
  @Environment(\.dismiss) private var dismiss
  @State private var radius = ""
  @FocusState private var editingRadius: Bool

  var body: some View {
    NavigationStack {
      Form {
        switch destination {
        case .language:
          Picker("Choose Language", selection: $preferences.language) {
            ForEach(AppLanguage.allCases) { Text($0.name).tag($0) }
          }.pickerStyle(.inline).accessibilityIdentifier("settings.language")
        case .searchType:
          Picker("Search Type", selection: $preferences.searchType) {
            ForEach(SearchType.allCases) { type in
              Text(type.title(language: preferences.language)).tag(type)
                .accessibilityIdentifier("settings.searchType.\(type.rawValue)")
            }
          }.pickerStyle(.inline)
        case .range:
          Section {
            HStack {
              TextField("Distance in meters", text: $radius).keyboardType(.numberPad)
                .focused($editingRadius).accessibilityIdentifier("settings.radius.custom")
                .accessibilityLabel("Distance in meters")
              Text(verbatim: "m").foregroundStyle(.secondary).accessibilityHidden(true)
            }
          } footer: {
            if editingRadius && Int(radius).map(AppPreferences.validRadius) != true {
              Text("Enter a distance from 1 to 50,000 meters.")
            }
          }
        case .source:
          Section {
            Label("Apple Maps", systemImage: "map")
          } footer: {
            Text("The map and walking directions use Apple Maps. Attribution appears on the map.")
          }
        case .about:
          Section {
            LabeledContent(
              "Lycoris Maps",
              value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
                as? String ?? "")
            Text(
              "A simple map for finding accessible toilets, nursing rooms, and medical institutions."
            )
          }
          Section {
            Text(
              "Shared Lycoris links open places in the installed app. Place availability depends on your access."
            )
          }
        }
      }
      .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
      .scrollDismissesKeyboard(.interactively)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") {
            commitRadius()
            dismiss()
          }.accessibilityIdentifier("settings.done")
        }
        ToolbarItemGroup(placement: .keyboard) {
          Spacer()
          Button("Done") {
            commitRadius()
            editingRadius = false
          }.accessibilityIdentifier("settings.keyboard-done")
        }
      }
      .onAppear { radius = String(preferences.radius) }
      .onChange(of: editingRadius) { _, editing in
        if !editing { commitRadius() }
      }
      .onDisappear { commitRadius() }
    }
    .presentationDragIndicator(.visible)
  }

  private func commitRadius() {
    guard destination == .range else { return }
    if let value = Int(radius.trimmingCharacters(in: .whitespacesAndNewlines)),
      value != preferences.radius
    {
      preferences.setRadius(value)
    }
    // Empty or out-of-range edits leave the last saved value intact.
    radius = String(preferences.radius)
  }

  private var title: String {
    switch destination {
    case .language: String(appLocalized: "Choose Language", language: preferences.language)
    case .searchType: String(appLocalized: "Search Type", language: preferences.language)
    case .range: String(appLocalized: "Searching Range", language: preferences.language)
    case .source: String(appLocalized: "Map Source", language: preferences.language)
    case .about: String(appLocalized: "About Lycoris Maps", language: preferences.language)
    }
  }
}
