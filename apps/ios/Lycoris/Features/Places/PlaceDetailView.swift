import SwiftUI

struct PlaceDetailView: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  let place: PlacePresentation
  let bottomInset: CGFloat
  let onUnavailableAction: () -> Void
  @ScaledMetric(relativeTo: .body) private var buttonHeight: CGFloat = 48

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        HStack(alignment: .top, spacing: 8) {
          Text(place.detailTitle).font(.title3.weight(.semibold))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("place.title")
          Button(action: onUnavailableAction) {
            Image("PlaceEdit").resizable().frame(width: 20, height: 20)
              .frame(width: 28, height: 28)
          }
          .buttonStyle(.plain).accessibilityLabel("Edit place")
        }
        .padding(.horizontal, 24).padding(.top, 10)

        HStack(spacing: 16) {
          Text(place.distance)
          Text(place.openingHours)
        }
        .font(.subheadline).foregroundStyle(.secondary)
        .padding(.horizontal, 24).padding(.top, 10)

        Text(place.description).font(.subheadline).foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 24).padding(.top, 5)

        Image(place.photoAsset).resizable().aspectRatio(353.0 / 198, contentMode: .fit)
          .clipShape(RoundedRectangle(cornerRadius: 16))
          .padding(.horizontal, 15).padding(.top, 5)
          .accessibilityLabel("Place photo")

        let actionLayout =
          dynamicTypeSize.isAccessibilitySize
          ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 12))
        actionLayout {
          actionLabel("Share", image: "PlaceShare", size: 20)
            .buttonStyle(.glass)
          actionLabel("Navigate", image: "PlaceNavigate", size: 24)
            .buttonStyle(.glassProminent)
          Button(action: onUnavailableAction) {
            Image("PlaceBookmark").resizable().frame(width: 28, height: 28)
              .frame(minWidth: 28, minHeight: buttonHeight)
          }
          .buttonStyle(.plain).accessibilityLabel("Bookmark place")
        }
        .padding(.horizontal, 16).padding(.top, 8)
        .padding(.bottom, max(bottomInset, 29))
      }
    }
    .scrollIndicators(.hidden)
    .accessibilityIdentifier("place.details")
  }

  private func actionLabel(_ title: LocalizedStringKey, image: String, size: CGFloat) -> some View {
    Button(action: onUnavailableAction) {
      HStack(spacing: 6) {
        Text(title).font(.body.weight(.medium))
          .lineLimit(1).minimumScaleFactor(0.85)
        Image(image).resizable().frame(width: size, height: size)
      }
      .frame(maxWidth: .infinity, minHeight: max(32, buttonHeight - 16))
      .contentShape(Capsule())
    }
    .buttonBorderShape(.capsule)
  }
}
