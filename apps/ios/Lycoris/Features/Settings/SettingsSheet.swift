import SwiftUI

enum SettingsDestination: String, Identifiable {
  case language, range, source, about
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
        case .range:
          Section {
            ForEach([1000, 2500], id: \.self) { value in
              Button {
                preferences.setRadius(value)
                radius = String(value)
                editingRadius = false
              } label: {
                HStack {
                  Text(AppPreferences.radiusLabel(value))
                  Spacer()
                  if preferences.radius == value { Image(systemName: "checkmark") }
                }.foregroundStyle(.primary)
              }.accessibilityIdentifier("settings.radius.\(value)")
                .accessibilityAddTraits(preferences.radius == value ? .isSelected : [])
            }
          }
          Section {
            TextField("Distance in meters", text: $radius).keyboardType(.numberPad)
              .focused($editingRadius).accessibilityIdentifier("settings.radius.custom")
            Button("Apply") {
              if let value = Int(radius), preferences.setRadius(value) { editingRadius = false }
            }.disabled(Int(radius).map(AppPreferences.validRadius) != true)
              .accessibilityIdentifier("settings.radius.apply")
          } footer: {
            Text("Enter a distance from 1 to 50,000 meters.")
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
          Button("Done") { dismiss() }.accessibilityIdentifier("settings.done")
        }
        ToolbarItemGroup(placement: .keyboard) {
          Spacer()
          Button("Done") { editingRadius = false }
        }
      }
      .onAppear { radius = String(preferences.radius) }
    }
    .presentationDragIndicator(.visible)
  }

  private var title: String {
    switch destination {
    case .language: String(appLocalized: "Choose Language", language: preferences.language)
    case .range: String(appLocalized: "Searching Range", language: preferences.language)
    case .source: String(appLocalized: "Map Source", language: preferences.language)
    case .about: String(appLocalized: "About Lycoris Maps", language: preferences.language)
    }
  }
}
