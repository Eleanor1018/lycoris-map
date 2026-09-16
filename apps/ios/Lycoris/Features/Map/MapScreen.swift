import MapKit
import SwiftUI

struct MapScreen: View {
  @State private var detent: MapPanelDetent
  @State private var store: PlaceStore
  @State private var location = LocationProvider()
  @State private var sharedPlace: PlacePresentation?
  @State private var showsLocationError = false
  @State private var showsNavigationError = false
  private var selectedPlace: PlacePresentation? { store.selectedPlace }
  @State private var showsUnavailableAction = false
  private let bookmarks: [PlacePresentation]
  @GestureState private var dragTranslation: CGFloat = 0
  @State private var query = ""
  @State private var keyboardHeight: CGFloat = 0
  @FocusState private var isSearchFocused: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @ScaledMetric(relativeTo: .subheadline) private var searchHeight: CGFloat = 38
  @ScaledMetric(relativeTo: .body) private var cardHeight: CGFloat = 66
  @ScaledMetric(relativeTo: .title3) private var titleHeight: CGFloat = 24

  init(
    initialDetent: MapPanelDetent = .collapsed, bookmarks: [PlacePresentation] = [],
    initialPlace: PlacePresentation? = nil, isPreview: Bool = false
  ) {
    _detent = State(initialValue: initialDetent)
    _store = State(initialValue: PlaceStore(isPreview: isPreview, initialPlace: initialPlace))
    self.bookmarks = bookmarks
  }

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
        nearbyContentHeight: titleHeight + 8 + cardHeight * 2 + 12,
        detailHeight: selectedPlace == nil
          ? nil
          : 208 + (selectedPlace?.hasPhoto == true ? (geometry.size.width - 50) * 198 / 353 : 0)
            + (selectedPlace?.distanceReference != nil ? 30 : 0)
            + max(geometry.safeAreaInsets.bottom, 29)
      )
      let panelTop = layout.clampedTop(layout.top(for: detent) + dragTranslation)
      let panelHeight = layout.height(at: panelTop)
      let toolsVisible = panelTop > layout.topInset + 270 && !isSearchFocused
      // Keep attribution fixed above the panel's lowest resting position.
      let mapBottomInset = layout.viewport.height - layout.collapsedTop + 10

      ZStack(alignment: .topLeading) {
        NativeMapView(
          topInset: layout.topInset, bottomInset: mapBottomInset,
          places: store.mapPlaces, focus: store.focus,
          showsUserLocation: !store.isPreview && location.hasRequestedLocation
            && location.isAuthorized, animated: !reduceMotion,
          onViewport: { store.viewportChanged($0) }, onSelect: selectPlace
        )
        .accessibilityIdentifier("map.canvas")

        MapTools(
          spacing: selectedPlace == nil ? 23 : 10,
          locate: locate,
          showNearby: { showNearby(.toilet) },
          onUnavailableAction: { showsUnavailableAction = true }
        )
        .position(x: layout.viewport.width - 40, y: panelTop - (selectedPlace == nil ? 131.5 : 116))
        .opacity(toolsVisible ? 1 : 0)
        .allowsHitTesting(toolsVisible)
        .accessibilityHidden(!toolsVisible)

        panel(layout: layout, height: panelHeight)
          .frame(
            width: layout.viewport.width - layout.horizontalInset(at: panelTop) * 2,
            height: panelHeight
          )
          .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26))
          .background {
            RoundedRectangle(cornerRadius: 26)
              .fill(Color("PanelTint").opacity(0.4 * layout.collapsedProgress(at: panelTop)))
          }
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
    .alert("Not available yet", isPresented: $showsUnavailableAction) {
      Button("OK", role: .cancel) {}
    }
    .alert("Location unavailable", isPresented: $showsLocationError) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(
        "You can browse the map without location access. To use your location, enable it in Settings and try again."
      )
    }
    .alert("Could not open Apple Maps", isPresented: $showsNavigationError) {
      Button("OK", role: .cancel) {}
    }
    .sheet(item: $sharedPlace) { PlaceShareSheet(place: $0) }
    .onChange(of: query) { _, text in
      if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        store.search(text)
      } else if case .search = store.browse {
        store.closeResults()
      }
    }
    .onDisappear { store.stop() }
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
      grabber(layout: layout)
      if let selectedPlace {
        PlaceDetailView(
          place: selectedPlace, bottomInset: layout.bottomInset,
          state: store.detailState, onRetry: store.retryDetail,
          onShare: {
            if store.isPreview {
              showsUnavailableAction = true
            } else {
              sharedPlace = selectedPlace
            }
          },
          onNavigate: { navigate(selectedPlace) },
          onUnavailableAction: { showsUnavailableAction = true })
      } else {
        MapSearchBar(
          query: $query, focused: $isSearchFocused, height: max(38, searchHeight),
          onSubmit: { store.search(query, debounce: false) },
          onUnavailableAction: { showsUnavailableAction = true }
        )
        .padding(.horizontal, 14)
        .padding(.bottom, detent == .collapsed ? 14 : detent == .nearby ? 7 : 11)

        ScrollView {
          VStack(spacing: 8) {
            if store.browse != nil || store.pendingNearby != nil {
              PlaceResultsView(store: store, onSelect: selectPlace) {
                query = ""
                store.closeResults()
              }
            } else {
              if case .failed = store.viewportState {
                PlaceLoadStatus(state: store.viewportState, retry: store.retryResults)
              }
              MapPanelContent(
                cardHeight: cardHeight, showsSettings: detent == .expanded,
                bookmarks: bookmarks, onCategory: showNearby, onSelect: selectPlace,
                onUnavailableAction: { showsUnavailableAction = true })
            }
          }
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
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
  }

  private func grabber(layout: PanelLayout) -> some View {
    Button {
      movePanel(to: detent == .collapsed ? .nearby : detent == .nearby ? .expanded : .collapsed)
    } label: {
      Capsule().fill(.secondary.opacity(0.4))
        .frame(width: 48, height: 4)
        .offset(
          x: -14 + 15 * layout.collapsedProgress(at: layout.top(for: detent) + dragTranslation)
        )
        .frame(maxWidth: .infinity).frame(height: 14)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Map panel")
    .accessibilityValue(
      selectedPlace != nil && detent == .nearby ? Text("Place details") : detent.accessibilityName
    )
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

  }

  private func selectPlace(_ place: PlacePresentation) {
    isSearchFocused = false
    withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.86)) {
      store.select(place)
      detent = .nearby
    }
  }

  private func showNearby(_ category: PlaceCategory) {
    query = ""
    let token = store.nearby(category)
    movePanel(to: .nearby)
    guard !store.isPreview else { return }
    location.request { result in
      if case .success(let point) = result { store.resolveNearbyLocation(point, token: token) }
    }
  }

  private func locate() {
    guard !store.isPreview else {
      showsUnavailableAction = true
      return
    }
    let token = store.beginLocationRequest()
    location.request { result in
      guard store.acceptsLocation(token) else { return }
      switch result {
      case .success(let point): store.locate(point, token: token)
      case .failure: showsLocationError = true
      }
    }
  }

  private func navigate(_ place: PlacePresentation) {
    guard !store.isPreview else {
      showsUnavailableAction = true
      return
    }
    guard let point = place.point else { return }
    let item = MKMapItem(
      location: CLLocation(latitude: point.latitude, longitude: point.longitude), address: nil)
    item.name = place.title
    if !item.openInMaps(launchOptions: [
      MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking
    ]) {
      showsNavigationError = true
    }
  }

  private func movePanel(to newDetent: MapPanelDetent) {
    if newDetent != .expanded { isSearchFocused = false }
    withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.86)) {
      if newDetent == .collapsed { store.closeDetail() }
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
