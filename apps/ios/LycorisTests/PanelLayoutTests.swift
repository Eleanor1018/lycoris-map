import Foundation
import Testing

@testable import Lycoris

struct PanelLayoutTests {
  private func layout(height: CGFloat = 874, top: CGFloat = 62, bottom: CGFloat = 34) -> PanelLayout
  {
    PanelLayout(
      viewport: CGSize(width: 402, height: height), topInset: top, bottomInset: bottom,
      headerHeight: 66, nearbyContentHeight: 176)
  }

  @Test func referenceStatesRespectSafeAreasAndDesignInsets() {
    let layout = layout()
    #expect(layout.top(for: .collapsed) == 774)
    #expect(layout.top(for: .nearby) == 598)
    #expect(layout.top(for: .expanded) == 70)
    #expect(layout.horizontalInset(at: 774) == 25)
    #expect(layout.horizontalInset(at: 598) == 10)
    #expect(layout.horizontalInset(at: 70) == 10)
    #expect(layout.height(at: 774) == 66)
  }

  @Test func draggingKeepsThePanelAndItsBottomGapContinuous() {
    let layout = layout()
    let middle = (layout.collapsedTop + layout.nearbyTop) / 2
    #expect(layout.horizontalInset(at: middle) == 17.5)
    #expect(layout.bottomGap(at: middle) == 17)
    #expect(layout.height(at: middle) + middle + layout.bottomGap(at: middle) == 874)
  }

  @Test func gestureBoundsAndProjectedLandingCannotLeaveTheViewport() {
    let layout = layout()
    #expect(layout.clampedTop(-1_000) == layout.expandedTop)
    #expect(layout.clampedTop(10_000) == layout.collapsedTop)
    #expect(layout.nearest(to: 620) == .nearby)
    #expect(layout.nearest(to: -200) == .expanded)
    #expect(layout.nearest(to: 2_000) == .collapsed)
  }

  @Test(arguments: [667.0, 874.0, 956.0])
  func allStatesFitDifferentPhoneHeights(height: Double) {
    let layout = layout(height: height)
    for detent in MapPanelDetent.allCases {
      let top = layout.top(for: detent)
      #expect(top >= layout.topInset)
      #expect(layout.height(at: top) > 0)
      #expect(top + layout.height(at: top) <= height)
    }
  }

  @Test func coincidentDetentsStillAllowTheCompletePanel() {
    let layout = PanelLayout(
      viewport: CGSize(width: 375, height: 667), topInset: 20, bottomInset: 0, headerHeight: 146,
      nearbyContentHeight: 500)
    #expect(layout.nearbyTop == layout.expandedTop)
    #expect(layout.nearest(to: 28) == .expanded)
    #expect(layout.nearest(to: 80) == .expanded)
  }
}
