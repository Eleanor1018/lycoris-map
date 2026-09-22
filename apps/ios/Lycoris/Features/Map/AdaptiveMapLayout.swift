import Foundation

/// Window geometry, independent of device identity or navigation state.
struct AdaptiveMapLayout {
  let size: CGSize
  var usesSidebar: Bool { size.width >= 760 && size.height >= 440 }
  var showsNavigationLabels: Bool { size.width >= 1180 }
  var navigationWidth: CGFloat { showsNavigationLabels ? 216 : 64 }
  var contentWidth: CGFloat { min(380, max(340, size.width * 0.32)) }
  let spacing: CGFloat = 12

  func leadingOcclusion(contentVisible: Bool) -> CGFloat {
    guard usesSidebar else { return 10 }
    return spacing + navigationWidth + spacing
      + (contentVisible ? contentWidth + spacing : 0)
  }
}

enum MapSidebarDestination: String {
  case search, bookmarks
}
