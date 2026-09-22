import SwiftUI

enum SettingsDestination: String, Identifiable, Hashable {
  case language, searchType, range, source, about
  var id: String { rawValue }
}

struct SettingsSheet: View {
  @Bindable var preferences: AppPreferences
  let destination: SettingsDestination
  var embedsNavigation = true
  @Environment(\.dismiss) private var dismiss
  @State private var radius = ""
  @FocusState private var editingRadius: Bool

  var body: some View {
    Group {
      if embedsNavigation {
        NavigationStack { content }
      } else {
        content
      }
    }
    .presentationDragIndicator(.visible)
  }

  private var content: some View {
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
            VStack(spacing: 11) {
              Image("LycorisMark")
                .resizable().scaledToFit().frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .accessibilityHidden(true)
              Text(verbatim: "Lycoris Maps").font(.title2.bold())
              Text("Version \(appVersion)").font(.caption).foregroundStyle(.secondary)
              Text("Across mountains and seas, together.").font(.headline)
                .padding(.top, 11)
              Text("A simple map for finding accessible toilets, nursing rooms, and medical institutions.")
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
          }.listRowBackground(Color.clear)
          Section {
            VStack(spacing: 11) {
              Link("View on GitHub", destination: repositoryURL)
                .buttonStyle(.borderedProminent).controlSize(.large)
                .accessibilityIdentifier("settings.about.repository")
              Link(destination: repositoryURL) {
                Text(verbatim: "github.com/Project-Lycoris/lycoris-map")
                  .font(.footnote)
              }
              .accessibilityIdentifier("settings.about.repository-url")
              Text("Thank you to all our contributors.")
                .font(.footnote).foregroundStyle(.secondary).padding(.top, 11)
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
          }.listRowBackground(Color.clear)
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

  private var appVersion: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
  }

  private let repositoryURL = URL(string: "https://github.com/Project-Lycoris/lycoris-map")!

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
