import MapKit
import SwiftUI

struct MapAppearanceSheet: View {
  @Bindable var preferences: AppPreferences
  let center: GeoPoint?
  var coordinateSpace: MapCoordinateSpace = .wgs84
  @Environment(\.dismiss) private var dismiss
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    NavigationStack {
      ScrollView {
        LazyVGrid(
          columns: Array(
            repeating: GridItem(.flexible(), spacing: 12),
            count: dynamicTypeSize.isAccessibilitySize ? 1 : MapAppearance.allCases.count),
          spacing: 16
        ) {
          ForEach(MapAppearance.allCases) { appearance in
            Button {
              preferences.mapAppearance = appearance
            } label: {
              VStack(spacing: 8) {
                MapAppearancePreview(
                  appearance: appearance, center: center, coordinateSpace: coordinateSpace
                )
                .frame(height: dynamicTypeSize.isAccessibilitySize ? 100 : 92)
                .clipShape(.rect(cornerRadius: 16))
                .overlay {
                  RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(
                      preferences.mapAppearance == appearance
                        ? Color.accentColor : Color.secondary.opacity(0.25),
                      lineWidth: preferences.mapAppearance == appearance ? 3 : 1)
                }
                Text(appearance.title).font(.subheadline.weight(.medium))
                  .multilineTextAlignment(.center).foregroundStyle(.primary)
              }
              .frame(maxWidth: .infinity).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(appearance.title)
            .accessibilityAddTraits(preferences.mapAppearance == appearance ? .isSelected : [])
            .accessibilityIdentifier("map.appearance.\(appearance.rawValue)")
          }
        }
        .padding()
      }
      .containerBackground(.clear, for: .navigation)
      .navigationTitle("Map Style").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Close", systemImage: "xmark") { dismiss() }
            .labelStyle(.iconOnly).accessibilityIdentifier("map.appearance.close")
        }
      }
    }
    .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.medium, .large] : [.height(250)])
    .presentationDragIndicator(.hidden)
    .presentationBackground(.ultraThinMaterial)
  }
}

private struct MapAppearancePreview: View {
  let appearance: MapAppearance
  let center: GeoPoint?
  let coordinateSpace: MapCoordinateSpace
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.displayScale) private var displayScale
  @State private var image: UIImage?

  var body: some View {
    GeometryReader { geometry in
      ZStack {
        Color(.secondarySystemFill)
        if let image {
          Image(uiImage: image).resizable().scaledToFit()
            .frame(width: geometry.size.width, height: geometry.size.height)
        } else {
          Image(systemName: appearance.symbol).font(.title).foregroundStyle(.secondary)
        }
      }
      .frame(width: geometry.size.width, height: geometry.size.height).clipped()
      .task(
        id: SnapshotKey(
          size: geometry.size, colorScheme: colorScheme, scale: displayScale, space: coordinateSpace
        )
      ) {
        await loadPreview(size: geometry.size)
      }
    }
    .accessibilityHidden(true)
  }

  private struct SnapshotKey: Equatable {
    let size: CGSize
    let colorScheme: ColorScheme
    let scale: CGFloat
    let space: MapCoordinateSpace
  }

  private func loadPreview(size: CGSize) async {
    guard size.width > 0, size.height > 0 else { return }
    let point = center ?? GeoPoint(latitude: 40.766, longitude: -74.077)!
    guard let coordinate = coordinateSpace.coordinate(for: point) else { return }
    let options = MKMapSnapshotter.Options()
    options.preferredConfiguration = appearance.configuration()
    options.region = MKCoordinateRegion(
      center: coordinate,
      latitudinalMeters: 1800, longitudinalMeters: 1800)
    // Match the cell exactly so the snapshot's native attribution is not cropped.
    options.size = size
    options.traitCollection = UITraitCollection(traitsFrom: [
      UITraitCollection(userInterfaceStyle: colorScheme == .dark ? .dark : .light),
      UITraitCollection(displayScale: displayScale),
    ])
    let snapshotter = MKMapSnapshotter(options: options)
    let cancel: @MainActor @Sendable () -> Void = { snapshotter.cancel() }
    await withTaskCancellationHandler {
      if let snapshot = try? await snapshotter.start(), !Task.isCancelled {
        image = snapshot.image
      }
    } onCancel: {
      Task { @MainActor in cancel() }
    }
  }
}
