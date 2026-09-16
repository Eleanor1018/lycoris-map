import SwiftUI

struct MapTools: View {
  var spacing: CGFloat = 23
  var showNearby: () -> Void
  var onUnavailableAction: () -> Void

  var body: some View {
    VStack(spacing: spacing) {
      VStack(spacing: 0) {
        Button(action: onUnavailableAction) {
          Image("Map").resizable().frame(width: 20, height: 20).frame(width: 48, height: 48)
        }.accessibilityLabel("Map source")
        Button(action: onUnavailableAction) {
          Image(systemName: "location").font(.title3).foregroundStyle(Color.accentColor)
            .frame(width: 48, height: 48)
        }.accessibilityLabel("Current location")
      }
      .glassEffect(in: .rect(cornerRadius: 24))

      VStack(spacing: 0) {
        Button(action: onUnavailableAction) {
          Image("Contribute").resizable().frame(width: 20, height: 20).frame(width: 48, height: 48)
        }.accessibilityLabel("Contribute")
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
