import SwiftUI

@main
struct LycorisApp: App {
  var body: some Scene {
    WindowGroup {
      #if DEBUG
        MapScreen(preview: .launchSelection)
      #else
        MapScreen()
      #endif
    }
  }
}
