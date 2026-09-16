import SwiftUI

struct PlaceRow: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  let place: PlacePresentation
  let onSelect: () -> Void
  @ScaledMetric(relativeTo: .body) private var rowHeight: CGFloat = 67

  var body: some View {
    Button(action: onSelect) {
      HStack(spacing: 12) {
        CategoryIcon(image: place.category.image, tint: place.category.tint)
        VStack(alignment: .leading, spacing: 3) {
          Text(place.title).font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, alignment: .leading)
          let metadataLayout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(spacing: 16))
          metadataLayout {
            if !place.distance.isEmpty { Text(place.distance) }
            Text(place.openingHours)
          }
          .font(.subheadline).foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 10)
      .frame(minHeight: rowHeight)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("place.row.\(place.id)")
  }
}
