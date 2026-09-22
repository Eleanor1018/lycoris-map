import SwiftUI

/// Use the same system Liquid Glass as the map tools, including OS accessibility behavior.
struct MapPanelSurface: ViewModifier {
  let shape: UnevenRoundedRectangle
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  func body(content: Content) -> some View {
    if reduceTransparency {
      content.background(Color(.secondarySystemBackground), in: shape)
    } else {
      content.glassEffect(in: shape)
    }
  }
}
