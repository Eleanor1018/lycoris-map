import MapKit
import SwiftUI

struct MapScreen: View {
  @State private var preferences = AppPreferences()
  @Namespace private var appearanceTransition
  @State private var locationDenied = false
  @State private var linkError = false
  @State private var focusKeyboardAfterDismiss = false
  @Environment(\.openURL) private var openURL
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @State private var detent: MapPanelDetent
  @State private var store: PlaceStore
  @State private var location = LocationProvider()
  @State private var account = AccountStore()
  @State private var contribution = ContributionStore()
  @State private var selectingLocation = false
  @State private var pickedLocation: GeoPoint?
  @State private var locationPickFeedback = 0
  @State private var screenCenter: GeoPoint?
  @State private var contributionIntent: ContributionIntent?
  @State private var queuedContribution: ContributionIntent?
  @State private var chooseLocationAfterDismiss = false
  @State private var contributionError: String?
  @State private var editLoadTask: Task<Void, Never>?
  @State private var modal: MapModal?
  @State private var pendingBookmark: Int64?
  @State private var bookmarkIntent = UUID()
  @State private var showsAccountError = false
  @Environment(\.scenePhase) private var scenePhase
  @State private var showsLocationError = false
  @State private var showsNavigationError = false
  private var selectedPlace: PlacePresentation? {
    account.selectedMarker.map { store.presentation($0) } ?? store.selectedPlace
  }
  private var mapPlaces: [PlacePresentation] {
    if account.detailState == .failed(.unavailable), let removed = account.selectedMarker {
      return store.mapPlaces.filter { $0.id != String(removed.id) }
    }
    guard let selected = account.selectedMarker.map({ store.presentation($0) }) else {
      return store.mapPlaces
    }
    return store.mapPlaces.filter { $0.id != selected.id } + [selected]
  }
  @State private var showsUnavailableAction = false
  private let bookmarks: [PlacePresentation]
  @GestureState private var dragTranslation: CGFloat = 0
  @State private var query = ""
  @State private var keyboardHeight: CGFloat = 0
  @FocusState private var isSearchFocused: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
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
        headerHeight: max(44, searchHeight) + 58,
        nearbyContentHeight: titleHeight + 8 + cardHeight
          * (dynamicTypeSize.isAccessibilitySize ? 3 : 2) + 24,
        detailHeight: selectedPlace == nil
          ? nil
          : 208 + (selectedPlace?.hasPhoto == true ? (geometry.size.width - 30) * 198 / 353 : 0)
            + (selectedPlace?.distanceReference != nil ? 30 : 0)
            + max(geometry.safeAreaInsets.bottom, 29),
        collapsedHeaderHeight: max(44, searchHeight) + 28
      )
      let panelTop = layout.clampedTop(layout.top(for: detent) + dragTranslation)
      let panelHeight = layout.height(at: panelTop)
      let panelShape = UnevenRoundedRectangle(
        topLeadingRadius: 26, bottomLeadingRadius: layout.bottomCornerRadius(at: panelTop),
        bottomTrailingRadius: layout.bottomCornerRadius(at: panelTop), topTrailingRadius: 26)
      let toolsVisible = panelTop > layout.topInset + 270 && !isSearchFocused && !selectingLocation
      // Keep attribution fixed above the panel's lowest resting position.
      let mapBottomInset = layout.viewport.height - layout.collapsedTop + 10

      ZStack(alignment: .topLeading) {
        NativeMapView(
          topInset: layout.topInset, bottomInset: mapBottomInset,
          appearance: preferences.mapAppearance,
          places: mapPlaces, focus: store.focus,
          showsUserLocation: !store.isPreview && location.hasRequestedLocation
            && location.isAuthorized, animated: !reduceMotion,
          isSelectingLocation: selectingLocation, selectedLocation: pickedLocation,
          onPickLocation: pickLocation,
          onViewport: { store.viewportChanged($0) },
          onSelect: { if !selectingLocation { selectPlace($0) } },
          onScreenCenter: { screenCenter = $0 }
        )
        .accessibilityIdentifier("map.canvas")
        .accessibilityHidden(detent == .expanded && !selectingLocation)

        MapTools(
          spacing: selectedPlace == nil ? 23 : 10,
          locate: locate,
          showNearby: { showNearby(.toilet) },
          contribute: { beginContribution(.create) },
          showMapAppearance: { modal = .mapAppearance(screenCenter) },
          appearanceTransition: appearanceTransition
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
          .background {
            if reduceTransparency {
              panelShape.fill(Color(.secondarySystemBackground))
            } else {
              panelShape.fill(.ultraThinMaterial)
            }
          }
          .background {
            panelShape
              .fill(Color("PanelTint").opacity(0.4 * layout.collapsedProgress(at: panelTop)))
          }
          .overlay {
            panelShape
              .strokeBorder(.white.opacity(0.28), lineWidth: 0.5)
              .allowsHitTesting(false)
          }
          .clipShape(panelShape)
          .shadow(color: .black.opacity(0.12), radius: 16, y: 4)
          .position(x: layout.viewport.width / 2, y: panelTop + panelHeight / 2)
          .opacity(selectingLocation ? 0 : 1)
          .allowsHitTesting(!selectingLocation)
          .accessibilityHidden(selectingLocation)

        if selectingLocation {
          VStack {
            HStack {
              Button("Cancel") {
                selectingLocation = false
                pickedLocation = nil
                if contribution.draft?.editable == true { modal = .contribution }
              }
              .buttonStyle(.glass).controlSize(.large)
              .accessibilityIdentifier("contribution.cancel-location")
              Spacer()
              Button("Current location", systemImage: "location", action: locate)
                .buttonStyle(.glass).controlSize(.large).labelStyle(.iconOnly)
            }
            Spacer()
            VStack(spacing: 12) {
              Text(
                pickedLocation == nil
                  ? "Tap the map to choose a location." : "Tap again to adjust the location."
              )
              .multilineTextAlignment(.center)
              if voiceOverEnabled {
                Button("Select map center") {
                  if let screenCenter { pickLocation(screenCenter) }
                }
                .disabled(screenCenter == nil)
              }
              Button("Use this location") { confirmLocation() }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(pickedLocation == nil)
                .accessibilityIdentifier("contribution.confirm-location")
                .accessibilityValue(
                  pickedLocation.map { String(format: "%.5f, %.5f", $0.latitude, $0.longitude) }
                    ?? ""
                )
            }
            .padding().frame(maxWidth: .infinity).background(
              .regularMaterial, in: .rect(cornerRadius: 26))
          }
          .padding(.horizontal).padding(.top, layout.topInset + 8)
          .padding(.bottom, max(layout.bottomInset, 16))
          .frame(width: layout.viewport.width, height: layout.viewport.height)
        }
      }
      .frame(width: layout.viewport.width, height: layout.viewport.height)
      .offset(y: -geometry.safeAreaInsets.top)
    }
    .ignoresSafeArea(.keyboard)
    .sensoryFeedback(.selection, trigger: locationPickFeedback)
    .alert("Not available yet", isPresented: $showsUnavailableAction) {
      Button("OK", role: .cancel) {}
    }
    .alert("Location unavailable", isPresented: $showsLocationError) {
      if locationDenied {
        Button("Open Settings") { openURL(URL(string: UIApplication.openSettingsURLString)!) }
      } else {
        Button("Try again", action: locate)
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        locationDenied
          ? "You can browse the map without location access. To use your location, enable it in Settings and try again."
          : "Could not get your location. You can try again or browse around the map center.")
    }
    .alert("Could not open Apple Maps", isPresented: $showsNavigationError) {
      Button("OK", role: .cancel) {}
    }
    .sheet(
      item: $modal,
      onDismiss: {
        if focusKeyboardAfterDismiss {
          focusKeyboardAfterDismiss = false
          isSearchFocused = true
        }
        pendingBookmark = nil
        bookmarkIntent = UUID()
        contributionIntent = nil
        if let intent = queuedContribution {
          queuedContribution = nil
          beginContribution(intent)
        } else if chooseLocationAfterDismiss {
          chooseLocationAfterDismiss = false
          enterLocationSelection(at: contribution.draft?.point)
        }
      }
    ) { item in
      switch item {
      case .share(let place): PlaceShareSheet(place: place)
      case .settings(let destination):
        SettingsSheet(preferences: preferences, destination: destination)
      case .mapAppearance(let center):
        MapAppearanceSheet(preferences: preferences, center: center)
          .navigationTransition(.zoom(sourceID: "map-appearance", in: appearanceTransition))
      case .voice:
        VoiceSearchSheet(
          language: preferences.language,
          onSearch: { text in
            modal = nil
            query = text
            movePanel(to: .expanded)
          },
          onKeyboard: {
            focusKeyboardAfterDismiss = true
            modal = nil
          })
      case .link(let link):
        PlaceLinkSheet(link: link, account: account) { marker, authenticated in
          guard case .link(let current) = modal, current == link else { return }
          modal = nil
          if authenticated {
            selectAccountPlace(marker)
          } else {
            selectPlace(store.presentation(marker))
          }
        }
      case .account(let destination):
        AccountSheet(
          store: account, destination: destination, onAuthenticated: resumeAuthenticatedAction,
          onSelect: selectAccountPlace)
      case .contribution:
        ContributionSheet(store: contribution) {
          chooseLocationAfterDismiss = true
          modal = nil
        }
      }
    }
    .alert("Account", isPresented: $showsAccountError) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(account.message ?? "")
    }
    .alert(
      "Contribute",
      isPresented: Binding(
        get: { contributionError != nil }, set: { if !$0 { contributionError = nil } })
    ) {
      Button("OK", role: .cancel) { contributionError = nil }
    } message: {
      Text(contributionError ?? "")
    }
    .onOpenURL { url in
      guard let link = PlaceLink(url: url), modal == nil, !selectingLocation else {
        linkError = true
        return
      }
      isSearchFocused = false
      modal = .link(link)
    }
    .alert("Could not open place link", isPresented: $linkError) {
      Button("OK", role: .cancel) {}
    } message: {
      Text("Check the link and close any open sheet before trying again.")
    }
    .onChange(of: preferences.language) { _, _ in applyPreferences() }
    .onChange(of: preferences.radius) { _, _ in applyPreferences() }
    .onChange(of: preferences.searchType) { _, _ in applyPreferences() }
    .onChange(of: location.isAuthorized) { _, authorized in
      if !authorized { store.revokeLocation() }
    }
    .task {
      applyPreferences()
      if !store.isPreview {
        contribution.connect(account)
        await account.restore()
        contribution.synchronize()
      }
    }
    .onChange(of: scenePhase) { _, phase in
      guard !store.isPreview else { return }
      contribution.setActive(phase == .active)
      if phase == .active {
        location.refreshAuthorization()
        if !location.isAuthorized { store.revokeLocation() }
        Task {
          await account.restore()
          contribution.synchronize()
        }
      }
    }
    .onChange(of: account.epoch) { _, _ in
      contribution.synchronize()
      if account.user == nil {
        editLoadTask?.cancel()
        selectingLocation = false
        pickedLocation = nil
        chooseLocationAfterDismiss = false
        if case .contribution = modal { modal = nil }
      }
    }
    .onChange(of: account.user?.publicId) { old, new in
      if old != nil, old != new {
        editLoadTask?.cancel()
        selectingLocation = false
        pickedLocation = nil
        chooseLocationAfterDismiss = false
        queuedContribution = nil
        if case .contribution = modal { modal = nil }
        if case .link = modal { modal = nil }
      }
    }
    .onChange(of: account.detailState) { _, state in
      if state == .failed(.unavailable), let id = account.selectedMarker?.id {
        store.removeUnavailable(id)
      }
    }
    .onChange(of: query) { _, text in
      if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        account.closeDetail()
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
    .environment(\.locale, preferences.language.locale)
  }

  private func applyPreferences() {
    store.updatePreferences(
      language: preferences.language.rawValue, radius: preferences.radius,
      searchType: preferences.searchType)
    account.updateLanguage(preferences.language.rawValue)
  }

  private func panel(layout: PanelLayout, height: CGFloat) -> some View {
    VStack(spacing: 0) {
      grabber(layout: layout)
      if let selectedPlace {
        PlaceDetailView(
          place: selectedPlace, bottomInset: layout.bottomInset,
          state: account.selectedMarker == nil ? store.detailState : account.detailState,
          onRetry: {
            if let marker = account.selectedMarker {
              account.select(marker)
            } else {
              store.retryDetail()
            }
          },
          onShare: {
            if store.isPreview {
              showsUnavailableAction = true
            } else {
              modal = .share(selectedPlace)
            }
          },
          onNavigate: { navigate(selectedPlace) },
          onEdit: { if let id = Int64(selectedPlace.id) { beginContribution(.edit(id)) } },
          isBookmarked: Int64(selectedPlace.id).map(account.isBookmarked) ?? false,
          bookmarkBusy: account.isBusy || account.libraryLoading || account.isChecking,
          onBookmark: { bookmark(selectedPlace) },
          authenticatedPhoto: account.selectedMarker != nil,
          photo: account.selectedPhoto, photoFailed: account.photoFailed,
          onUnavailableAction: { showsUnavailableAction = true })
      } else {
        MapSearchBar(
          query: $query, focused: $isSearchFocused, height: max(44, searchHeight),
          onSubmit: { store.search(query, debounce: false) },
          user: account.user, avatar: account.avatar,
          onAccount: {
            isSearchFocused = false
            if store.isPreview { showsUnavailableAction = true } else { modal = .account(.profile) }
          },
          onVoiceSearch: {
            isSearchFocused = false
            modal = .voice
          }
        )
        .padding(.horizontal, 14)
        .padding(.bottom, detent == .collapsed ? 14 : detent == .nearby ? 7 : 11)

        Group {
          if store.browse != nil || store.pendingNearby != nil {
            ScrollView {
              PlaceResultsView(store: store, onSelect: selectPlace) {
                query = ""
                store.closeResults()
              }
              .padding(.horizontal, 14)
              .padding(.bottom, keyboardHeight > 0 ? 12 : max(layout.bottomInset, 12))
            }
          } else {
            MapPanelContent(
              preferences: preferences,
              onSettings: {
                isSearchFocused = false
                modal = .settings($0)
              },
              cardHeight: cardHeight, showsSettings: detent == .expanded,
              bottomInset: keyboardHeight > 0 ? 12 : max(layout.bottomInset, 12),
              viewportState: store.viewportState, onRetry: store.retryResults,
              bookmarks: store.isPreview ? bookmarks : account.bookmarks.map(store.presentation),
              showsBookmarks: account.user != nil,
              bookmarksLoading: account.libraryLoading, bookmarksMessage: account.libraryMessage,
              onBookmarks: {
                if store.isPreview {
                  showsUnavailableAction = true
                } else {
                  modal = .account(.bookmarks)
                }
              },
              onCategory: showNearby, onSelect: selectPlace,
              onUnavailableAction: { showsUnavailableAction = true })
          }
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .scrollDisabled(detent == .collapsed)
        .accessibilityHidden(height <= layout.headerHeight + 1)
        .allowsHitTesting(height > layout.headerHeight + 1)
        .ignoresSafeArea(.container, edges: .bottom)
        .padding(.bottom, keyboardHeight)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
  }

  private func grabber(layout: PanelLayout) -> some View {
    let progress = layout.collapsedProgress(
      at: layout.clampedTop(layout.top(for: detent) + dragTranslation))
    return Button {
      movePanel(to: detent == .collapsed ? .nearby : detent == .nearby ? .expanded : .collapsed)
    } label: {
      Capsule().fill(.secondary.opacity(0.4))
        .frame(width: 48, height: 4)
        // At rest the search row has 14pt above and below. Restore the full
        // handle area continuously as the floating search panel is pulled up.
        .frame(maxWidth: .infinity).frame(height: 44 - 30 * progress)
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
    if let marker = (account.bookmarks + account.created).first(where: { String($0.id) == place.id }
    ) {
      selectAccountPlace(marker)
      return
    }
    account.closeDetail()
    isSearchFocused = false
    withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.86)) {
      store.select(place)
      detent = .nearby
    }
  }

  private func showNearby(_ category: PlaceCategory) {
    account.closeDetail()
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
      case .failure(let failure):
        locationDenied = failure == .denied
        showsLocationError = true
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
      if newDetent == .collapsed {
        store.closeDetail()
        account.closeDetail()
      }
      detent = newDetent
    }
  }

  private func selectAccountPlace(_ marker: Marker) {
    isSearchFocused = false
    account.select(marker)
    store.focusAccountPlace(store.presentation(marker))
    movePanel(to: .nearby)
  }

  private func bookmark(_ place: PlacePresentation) {
    guard !store.isPreview else {
      showsUnavailableAction = true
      return
    }
    guard let id = Int64(place.id) else { return }
    guard account.user != nil else {
      bookmarkIntent = UUID()
      pendingBookmark = id
      modal = .account(.profile)
      return
    }
    Task {
      await account.toggleBookmark(id)
      showsAccountError = account.message != nil
    }
  }

  private func resumeBookmark() {
    guard let id = pendingBookmark, let owner = account.user?.publicId else { return }
    let token = account.epoch
    let intent = bookmarkIntent
    pendingBookmark = nil
    Task {
      await account.loadLibrary()
      guard owner == account.user?.publicId, token == account.epoch, intent == bookmarkIntent else {
        return
      }
      if !account.isBookmarked(id) { await account.toggleBookmark(id) }
      guard owner == account.user?.publicId, token == account.epoch, intent == bookmarkIntent else {
        return
      }
      modal = nil
      showsAccountError = account.message != nil
    }
  }

  private func resumeAuthenticatedAction() {
    contribution.synchronize()
    if let intent = contributionIntent {
      queuedContribution = intent
      modal = nil
    } else {
      resumeBookmark()
    }
  }

  private func beginContribution(_ intent: ContributionIntent) {
    editLoadTask?.cancel()
    guard !store.isPreview else {
      showsUnavailableAction = true
      return
    }
    guard account.user != nil else {
      contributionIntent = intent
      modal = .account(.profile)
      return
    }
    contribution.synchronize()
    isSearchFocused = false
    if let draft = contribution.draft, draft.phase != .complete {
      modal = .contribution
      return
    }
    switch intent {
    case .create:
      enterLocationSelection()
    case .edit(let id):
      editLoadTask = Task {
        do {
          try await contribution.edit(id)
          modal = .contribution
        } catch {
          guard !Task.isCancelled, !(error is CancellationError) else { return }
          contributionError =
            (error as? AccountFailure)?.message
            ?? String(appLocalized: "Could not load places. Please try again.")
        }
      }
    }
  }

  private func enterLocationSelection(at point: GeoPoint? = nil) {
    guard account.user != nil else { return }
    movePanel(to: .collapsed)
    pickedLocation = point
    if let point { store.focusMap(on: point) }
    selectingLocation = true
  }

  private func pickLocation(_ point: GeoPoint) {
    guard selectingLocation else { return }
    pickedLocation = point
    locationPickFeedback += 1
  }

  private func confirmLocation() {
    guard selectingLocation, let point = pickedLocation else { return }
    do {
      try contribution.begin(at: point)
      try contribution.move(to: point)
      selectingLocation = false
      pickedLocation = nil
      modal = .contribution
    } catch {
      contributionError = String(appLocalized: "Could not save the contribution on this device.")
    }
  }
}

private enum ContributionIntent {
  case create
  case edit(Int64)
}

private enum MapModal: Identifiable {
  case account(AccountDestination)
  case share(PlacePresentation)
  case contribution
  case settings(SettingsDestination)
  case mapAppearance(GeoPoint?)
  case voice
  case link(PlaceLink)
  var id: String {
    switch self {
    case .account: "account"
    case .share(let place): "share-\(place.id)"
    case .contribution: "contribution"
    case .settings(let destination): "settings-\(destination.rawValue)"
    case .mapAppearance: "map-appearance"
    case .voice: "voice"
    case .link(let link): "link-\(link.id)"
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
