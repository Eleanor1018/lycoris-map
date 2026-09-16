import SwiftUI

struct PlaceRow: View {
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
          HStack(spacing: 16) {
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
