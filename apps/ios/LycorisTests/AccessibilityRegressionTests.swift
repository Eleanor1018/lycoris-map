import Foundation
import Testing

@testable import Lycoris

/// Regression tests for the five accessibility fixes. Each assertion fails on
/// the pre-fix behavior.
@MainActor
struct AccessibilityRegressionTests {
  private func place(
    id: Int64, category: PlaceCategory, title: String = "Same Name",
    distance: String = "", openingHours: String = "09:00–21:00"
  ) -> PlacePresentation {
    let marker = Marker(
      id: id, version: 1, lat: 31.2304, lng: 121.4737, category: category, title: title,
      description: nil, openTimeStart: "09:00", openTimeEnd: "21:00", markImage: nil,
      contentLanguage: "en")
    var presentation = PlacePresentation(
      marker: marker, origin: nil, located: true, baseURL: nil)
    // Reproduce a controlled visual distance without an origin so the label uses it.
    if !distance.isEmpty {
      presentation = PlacePresentation(
        id: presentation.id, title: presentation.title, detailTitle: presentation.detailTitle,
        distance: distance, openingHours: openingHours, description: "",
        photoAsset: "", latitude: presentation.latitude, longitude: presentation.longitude)
      presentation.category = category
    }
    return presentation
  }

  // MARK: - 1. Place/pin labels include the localized category

  @Test func sameNamePlacesGetDistinctLocalizedCategoryLabels() {
    let toilet = place(id: 1, category: .toilet)
    let nursing = place(id: 2, category: .nursing)
    let medical = place(id: 3, category: .medical)

    let enToilet = PlaceAccessibility.placeLabel(toilet, language: .english)
    let enNursing = PlaceAccessibility.placeLabel(nursing, language: .english)
    let enMedical = PlaceAccessibility.placeLabel(medical, language: .english)

    #expect(enToilet != enNursing && enNursing != enMedical && enToilet != enMedical)
    #expect(enToilet.hasPrefix(PlaceAccessibility.categoryLabel(.toilet, language: .english)))
    #expect(enNursing.hasPrefix(PlaceAccessibility.categoryLabel(.nursing, language: .english)))
    #expect(enMedical.hasPrefix(PlaceAccessibility.categoryLabel(.medical, language: .english)))
    // Name and hours are still present; only the icon is redundant.
    for label in [enToilet, enNursing, enMedical] {
      #expect(label.contains("Same Name"))
      #expect(label.contains("09:00–21:00"))
    }

    let zhToilet = PlaceAccessibility.placeLabel(toilet, language: .chinese)
    let zhNursing = PlaceAccessibility.placeLabel(nursing, language: .chinese)
    #expect(zhToilet != enToilet && zhNursing != enNursing)
    #expect(zhToilet == "无障碍卫生间, Same Name, 09:00–21:00")
    #expect(zhToilet.contains(PlaceAccessibility.categoryLabel(.toilet, language: .chinese)))
    #expect(zhToilet != zhNursing)
  }

  @Test func unknownCustomCategoryFallsBackToPlacesInBothLanguages() {
    let other = place(id: 4, category: .other)
    let en = PlaceAccessibility.placeLabel(other, language: .english)
    let zh = PlaceAccessibility.placeLabel(other, language: .chinese)
    #expect(en.hasPrefix("Places"))
    #expect(zh.hasPrefix(PlaceAccessibility.categoryLabel(.other, language: .chinese)))
    #expect(en != zh)
  }

  // MARK: - 1b. Distance: present, missing and spoken form

  @Test func missingDistanceIsOmittedAndSpokenFormIsNatural() {
    let noDistance = place(id: 5, category: .toilet, distance: "")
    let label = PlaceAccessibility.placeLabel(noDistance, language: .english)
    // The distance fragment is absent, but name, category and hours remain.
    #expect(!label.contains("meters") && !label.contains("kilometers"))
    #expect(label == "Accessible Toilets, Same Name, 09:00–21:00")

    #expect(PlaceAccessibility.distanceDescription("", language: .english) == nil)
    #expect(PlaceAccessibility.distanceDescription("   ", language: .english) == nil)
    #expect(
      PlaceAccessibility.distanceDescription("230m", language: .english)
        == "about 230 meters away")
    #expect(
      PlaceAccessibility.distanceDescription("1.2km", language: .english)
        == "about 1.2 kilometers away")
    #expect(
      PlaceAccessibility.distanceDescription("230m", language: .chinese)
        == "大约 230 米")
  }

  @Test func distanceAppearsInLabelOnlyWhenPresent() {
    let withDistance = place(id: 6, category: .nursing, distance: "230m")
    #expect(
      PlaceAccessibility.placeLabel(withDistance, language: .english)
        .contains("about 230 meters away"))
    let withoutDistance = place(id: 7, category: .nursing, distance: "")
    #expect(
      !PlaceAccessibility.placeLabel(withoutDistance, language: .english).contains("meters"))
  }

  // MARK: - 2. Voice button semantics match its action in every state

  @Test func voiceButtonStateMatchesActionInEveryState() {
    // Panel open: recording stops, finishing is Recognizing/disabled; all other
    // states close. None may say "Start recording".
    #expect(
      VoiceSearchButtonState(isVoicePanelOpen: true, state: .recording) == .stop)
    #expect(
      VoiceSearchButtonState(isVoicePanelOpen: true, state: .finishing) == .recognizing)
    for state: VoiceSearchController.State in [
      .idle, .authorizing, .ready, .unsupported, .denied, .failed,
    ] {
      #expect(VoiceSearchButtonState(isVoicePanelOpen: true, state: state) == .close)
    }

    // Panel closed is always the start action.
    for state: VoiceSearchController.State in [
      .idle, .authorizing, .recording, .finishing, .ready, .unsupported, .denied, .failed,
    ] {
      #expect(VoiceSearchButtonState(isVoicePanelOpen: false, state: state) == .start)
    }
  }

  @Test func voiceButtonLabelsAndEnabledStateAreLocalizedAndConsistent() {
    let stop = VoiceSearchButtonState(isVoicePanelOpen: true, state: .recording)
    let close = VoiceSearchButtonState(isVoicePanelOpen: true, state: .denied)
    let recognizing = VoiceSearchButtonState(isVoicePanelOpen: true, state: .finishing)
    let start = VoiceSearchButtonState(isVoicePanelOpen: false, state: .idle)

    #expect(stop.label(language: .english) == "Stop recording")
    #expect(stop.label(language: .chinese) == "停止录音")
    #expect(close.label(language: .english) == "Close voice search")
    #expect(close.label(language: .chinese) != "Close voice search")
    #expect(start.label(language: .english) == "Voice search")
    #expect(start.label(language: .chinese) == "语音搜索")
    // Denied/unsupported/failed must never present the stop label.
    for state: VoiceSearchController.State in [.denied, .unsupported, .failed] {
      let value = VoiceSearchButtonState(isVoicePanelOpen: true, state: state)
      #expect(value.label(language: .english) != "Stop recording")
      #expect(value.isEnabled)
    }
    #expect(recognizing.label(language: .english) == "Recognizing…")
    #expect(!recognizing.isEnabled)
    #expect(stop.isEnabled && close.isEnabled && start.isEnabled)
    #expect(stop.usesActiveAppearance && close.usesActiveAppearance)
    #expect(!start.usesActiveAppearance)
    // A close action must not masquerade as recording with a waveform.
    #expect(start.symbolName == "microphone")
    #expect(stop.symbolName == "waveform")
    #expect(recognizing.symbolName == "waveform")
    #expect(close.symbolName == "xmark")
    for state: VoiceSearchController.State in [.idle, .authorizing, .ready, .unsupported, .failed] {
      let value = VoiceSearchButtonState(isVoicePanelOpen: true, state: state)
      #expect(value.symbolName == "xmark")
    }
  }

  // MARK: - 3. Grabber geometry

  @Test func grabberPlaceholderShrinksWhileRealButtonStays44pt() {
    let expanded = PanelLayout(
      viewport: CGSize(width: 402, height: 874), topInset: 62, bottomInset: 34,
      headerHeight: 66, nearbyContentHeight: 176)
    var collapsed = expanded
    collapsed.collapsedHeaderHeight = 44 + 28

    // Real handle is always 44pt tall regardless of detent.
    #expect(PanelLayout.grabberRealHeight == 44)
    // Placeholder keeps the old 44 → 14 layout at the two resting detents.
    #expect(expanded.grabberPlaceholderHeight(at: expanded.top(for: .expanded)) == 44)
    #expect(collapsed.grabberPlaceholderHeight(at: collapsed.top(for: .collapsed)) == 14)

    // Expanded: the real button exactly matches the old handle area.
    let expandedTop = expanded.top(for: .expanded)
    #expect(expanded.grabberCenterY(at: expandedTop) == expandedTop + 22)

    // Collapsed: the button keeps its bottom edge but overhangs 30pt upward.
    let collapsedTop = collapsed.top(for: .collapsed)
    let center = collapsed.grabberCenterY(at: collapsedTop)
    #expect(center == collapsedTop - 8)
    #expect(center + 22 == collapsedTop + 14)
    #expect(center - 22 == collapsedTop - 30)

    // Width narrows to 88pt when collapsed and is the full panel width when open.
    #expect(collapsed.grabberWidth(at: collapsedTop) == 88)
    #expect(expanded.grabberWidth(at: expandedTop) == expanded.viewport.width)
  }

  @Test func grabberRealButtonCoversCenterAndBothEdgesForTapping() {
    // A collapsed handle's 44pt vertical span must contain the old capsule's top
    // and bottom, so a tap on either edge expands the panel.
    var collapsed = PanelLayout(
      viewport: CGSize(width: 402, height: 874), topInset: 62, bottomInset: 34,
      headerHeight: 66, nearbyContentHeight: 176)
    collapsed.collapsedHeaderHeight = 44 + 28
    let top = collapsed.top(for: .collapsed)
    let center = collapsed.grabberCenterY(at: top)
    let upper = center - 22
    let lower = center + 22
    let oldCapsuleCenter = top + 7
    #expect(upper < oldCapsuleCenter && oldCapsuleCenter < lower)
    #expect(lower - upper == 44)
  }
}
