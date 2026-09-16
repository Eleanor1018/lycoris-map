import MapKit
import SwiftUI

struct MapScreen: View {
  @State private var detent: MapPanelDetent = .collapsed
  @GestureState private var dragTranslation: CGFloat = 0
  @State private var query = ""
  @State private var keyboardHeight: CGFloat = 0
  @FocusState private var isSearchFocused: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @ScaledMetric(relativeTo: .subheadline) private var searchHeight: CGFloat = 38
  @ScaledMetric(relativeTo: .body) private var cardHeight: CGFloat = 66
  @ScaledMetric(relativeTo: .title3) private var titleHeight: CGFloat = 24

  var body: some View {
    GeometryReader { geometry in
      let layout = PanelLayout(
        viewport: CGSize(
          width: geometry.size.width,
          height: geometry.size.height + geometry.safeAreaInsets.top
            + geometry.safeAreaInsets.bottom),
        topInset: geometry.safeAreaInsets.top,
        bottomInset: geometry.safeAreaInsets.bottom,
        headerHeight: max(38, searchHeight) + 28,
        nearbyContentHeight: titleHeight + 8 + cardHeight * 2 + 12
      )
      let panelTop = layout.clampedTop(layout.top(for: detent) + dragTranslation)
      let panelHeight = layout.height(at: panelTop)
      let toolsVisible = panelTop > layout.topInset + 270 && !isSearchFocused
      // Keep attribution fixed above the panel's lowest resting position.
      let mapBottomInset = layout.viewport.height - layout.collapsedTop + 10

      ZStack(alignment: .topLeading) {
        NativeMapView(topInset: layout.topInset, bottomInset: mapBottomInset)
          .accessibilityIdentifier("map.canvas")

        MapTools { movePanel(to: .nearby) }
          .position(x: layout.viewport.width - 40, y: panelTop - 131.5)
          .opacity(toolsVisible ? 1 : 0)
          .allowsHitTesting(toolsVisible)
          .accessibilityHidden(!toolsVisible)

        panel(layout: layout, height: panelHeight)
          .frame(
            width: layout.viewport.width - layout.horizontalInset(at: panelTop) * 2,
            height: panelHeight
          )
          .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26))
          .overlay {
            RoundedRectangle(cornerRadius: 26)
              .strokeBorder(.white.opacity(0.28), lineWidth: 0.5)
              .allowsHitTesting(false)
          }
          .clipShape(RoundedRectangle(cornerRadius: 26))
          .shadow(color: .black.opacity(0.12), radius: 16, y: 4)
          .position(x: layout.viewport.width / 2, y: panelTop + panelHeight / 2)
      }
      .frame(width: layout.viewport.width, height: layout.viewport.height)
      .offset(y: -geometry.safeAreaInsets.top)
    }
    .ignoresSafeArea(.keyboard)
    .onChange(of: isSearchFocused) { _, focused in
      if focused { movePanel(to: .expanded) }
    }
    .onReceive(
      NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)
    ) { notification in
      guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
      else { return }
      let screenHeight =
        UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }.first?.screen.bounds.height ?? 0
      keyboardHeight = max(0, screenHeight - frame.minY)
    }
    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification))
    { _ in
      keyboardHeight = 0
    }
  }

  private func panel(layout: PanelLayout, height: CGFloat) -> some View {
    VStack(spacing: 0) {
      VStack(spacing: 0) {
        Button {
          movePanel(to: detent == .collapsed ? .nearby : detent == .nearby ? .expanded : .collapsed)
        } label: {
          Capsule().fill(.secondary.opacity(0.4))
            .frame(width: 48, height: 4)
            .frame(maxWidth: .infinity).frame(height: 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Map panel")
        .accessibilityValue(detent.accessibilityName)
        .accessibilityIdentifier("map.panel.handle")
        .accessibilityAdjustableAction { direction in
          let states = MapPanelDetent.allCases
          guard let index = states.firstIndex(of: detent) else { return }
          switch direction {
          case .increment: movePanel(to: states[min(index + 1, states.count - 1)])
          case .decrement: movePanel(to: states[max(index - 1, 0)])
          @unknown default: break
          }
        }
        .highPriorityGesture(
          DragGesture(minimumDistance: 10, coordinateSpace: .global)
            .updating($dragTranslation) { value, translation, _ in
              if abs(value.translation.height) > abs(value.translation.width) {
                translation = value.translation.height
              }
            }
            .onChanged { value in
              guard abs(value.translation.height) > abs(value.translation.width) else { return }
              isSearchFocused = false
            }
            .onEnded { value in
              guard abs(value.translation.height) > abs(value.translation.width) else { return }
              let target = layout.nearest(
                to: layout.top(for: detent) + value.predictedEndTranslation.height)
              movePanel(to: target)
            }
        )

        MapSearchBar(query: $query, focused: $isSearchFocused, height: max(38, searchHeight))
          .padding(.horizontal, 14).padding(.bottom, 14)
      }

      ScrollView {
        MapPanelContent(cardHeight: cardHeight, showsSettings: detent == .expanded)
          .padding(.horizontal, 14)
          .padding(.bottom, max(layout.bottomInset, 14))
      }
      .scrollIndicators(.hidden)
      .scrollDismissesKeyboard(.interactively)
      .scrollDisabled(detent == .collapsed)
      .accessibilityHidden(height <= layout.headerHeight + 1)
      .allowsHitTesting(height > layout.headerHeight + 1)
      .padding(.bottom, keyboardHeight)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
  }

  private func movePanel(to newDetent: MapPanelDetent) {
    if newDetent != .expanded { isSearchFocused = false }
    withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.86)) {
      detent = newDetent
    }
  }
}

extension MapPanelDetent {
  fileprivate var accessibilityName: Text {
    switch self {
    case .collapsed: Text("Collapsed")
    case .nearby: Text("Nearby")
    case .expanded: Text("Expanded")
    }
  }
}

#Preview { MapScreen() }
