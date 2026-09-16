import SwiftUI

@main
struct LycorisApp: App {
  var body: some Scene {
    WindowGroup {
      #if DEBUG
        if let preview = MapPreviewScenario.launchSelection {
          MapScreen(preview: preview)
        } else {
          MapScreen()
        }
      #else
        MapScreen()
      #endif
    }
  }
}
