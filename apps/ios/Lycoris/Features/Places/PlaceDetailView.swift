import SwiftUI

struct PlaceDetailView: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  let place: PlacePresentation
  let bottomInset: CGFloat
  var state: PlaceStore.LoadState = .idle
  var onRetry: () -> Void = {}
  var onShare: () -> Void = {}
  var onNavigate: () -> Void = {}
  var onEdit: () -> Void = {}
  var isBookmarked = false
  var bookmarkBusy = false
  var onBookmark: (() -> Void)? = nil
  var authenticatedPhoto = false
  var photo: Data? = nil
  var photoFailed = false
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
          Button(action: onEdit) {
            Image("PlaceEdit").resizable().frame(width: 20, height: 20)
              .frame(width: 28, height: 28)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain).accessibilityLabel("Edit place")
          .accessibilityIdentifier("place.edit")
        }
        .padding(.horizontal, 24).padding(.top, 10)

        PlaceLoadStatus(state: state, retry: onRetry).padding(.horizontal, 18)
        if !hasFailed {
          HStack(spacing: 16) {
            if !place.distance.isEmpty { Text(place.distance) }
            Text(place.openingHours)
          }
          .font(.subheadline).foregroundStyle(.secondary)
          .padding(.horizontal, 24).padding(.top, 10)

          if let reference = place.distanceReference {
            Text(reference).font(.caption).foregroundStyle(.secondary)
              .padding(.horizontal, 24).padding(.top, 3)
          }
          if !place.description.isEmpty {
            Text(place.description).font(.subheadline).foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.horizontal, 24).padding(.top, 5)

          }
          if place.hasPhoto {
            PlacePhoto(
              place: place, authenticated: authenticatedPhoto, data: photo, photoFailed: photoFailed
            )
            .padding(.horizontal, 15).padding(.top, 5)
          }

          let actionLayout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 14))
          actionLayout {
            actionLabel("Share", image: "PlaceShare", size: 20, action: onShare)
              .buttonStyle(.glass)
            actionLabel("Navigate", image: "PlaceNavigate", size: 24, action: onNavigate)
              .buttonStyle(.glassProminent)
            Button(action: onBookmark ?? onUnavailableAction) {
              Group {
                if isBookmarked {
                  Image(systemName: "bookmark.fill").resizable().scaledToFit()
                } else {
                  Image("PlaceBookmark").resizable()
                }
              }.frame(width: 28, height: 28)
                .frame(minWidth: 44, minHeight: buttonHeight)
            }
            .buttonStyle(.plain).accessibilityLabel(
              isBookmarked ? "Remove bookmark" : "Bookmark place"
            )
            .accessibilityIdentifier("place.bookmark").disabled(bookmarkBusy)
          }
          .padding(.leading, 16).padding(.trailing, 22).padding(.top, 8)
          .padding(.bottom, max(bottomInset, 29))
        }
      }
    }
    .scrollIndicators(.hidden)
    .accessibilityIdentifier("place.details")
  }

  private var hasFailed: Bool {
    if case .failed = state { return true }
    return false
  }

  private func actionLabel(
    _ title: LocalizedStringKey, image: String, size: CGFloat, action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
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
