import SwiftUI

struct MapTools: View {
  var spacing: CGFloat = 23
  var locate: () -> Void = {}
  var showNearby: () -> Void
  var contribute: () -> Void = {}
  var showMapAppearance: () -> Void
  var appearanceTransition: Namespace.ID

  var body: some View {
    VStack(spacing: spacing) {
      VStack(spacing: 0) {
        Button(action: showMapAppearance) {
          Image("Map").resizable().frame(width: 20, height: 20).frame(width: 48, height: 48)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Map Style").accessibilityIdentifier("map.appearance")
        .matchedTransitionSource(id: "map-appearance", in: appearanceTransition)
        Button(action: locate) {
          Image(systemName: "location").font(.title3).foregroundStyle(Color.accentColor)
            .frame(width: 48, height: 48)
        }.accessibilityLabel("Current location").accessibilityIdentifier("map.locate")
      }
      .glassEffect(in: .rect(cornerRadius: 24))

      VStack(spacing: 0) {
        Button(action: contribute) {
          Image("Contribute").resizable().frame(width: 20, height: 20).frame(width: 48, height: 48)
            .contentShape(Rectangle())
        }.accessibilityLabel("Contribute").accessibilityIdentifier("map.contribute")
        Button(action: showNearby) {
          Image("Nearby").resizable().frame(width: 20, height: 20)
            .frame(width: 48, height: 48).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Find Nearby")
        .accessibilityIdentifier("map.nearby")
      }
      .glassEffect(in: .rect(cornerRadius: 24))
    }
    .buttonStyle(.plain)
    .fixedSize()
  }
}
