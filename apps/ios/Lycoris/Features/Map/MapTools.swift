import SwiftUI

struct MapTools: View {
  var showNearby: () -> Void

  var body: some View {
    VStack(spacing: 23) {
      VStack(spacing: 0) {
        Image("Map").resizable().frame(width: 20, height: 20)
          .frame(width: 48, height: 48).accessibilityLabel("Map source")
        Image(systemName: "location").font(.title3).foregroundStyle(Color.accentColor)
          .frame(width: 48, height: 48).accessibilityLabel("Current location")
      }
      .glassEffect(in: .rect(cornerRadius: 24))

      VStack(spacing: 0) {
        Image("Contribute").resizable().frame(width: 20, height: 20)
          .frame(width: 48, height: 48).accessibilityLabel("Contribute")
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
    .fixedSize()
  }
}
