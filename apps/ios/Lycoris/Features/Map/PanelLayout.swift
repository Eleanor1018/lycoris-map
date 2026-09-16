import Foundation

enum MapPanelDetent: String, CaseIterable {
  case collapsed, nearby, expanded
}

/// The only custom presentation geometry. Feature content does not own drag state.
struct PanelLayout {
  let viewport: CGSize
  let topInset: CGFloat
  let bottomInset: CGFloat
  let headerHeight: CGFloat
  let nearbyContentHeight: CGFloat
  var detailHeight: CGFloat? = nil
  var collapsedHeaderHeight: CGFloat? = nil

  var collapsedTop: CGFloat {
    max(
      expandedTop,
      viewport.height - max(bottomInset, 29) - (collapsedHeaderHeight ?? headerHeight))
  }
  var expandedTop: CGFloat { topInset + 8 }
  var nearbyTop: CGFloat {
    max(
      expandedTop,
      min(
        collapsedTop,
        viewport.height
          - (detailHeight ?? (headerHeight + nearbyContentHeight + max(bottomInset, 29))))
    )
  }

  func top(for detent: MapPanelDetent) -> CGFloat {
    switch detent {
    case .collapsed: collapsedTop
    case .nearby: nearbyTop
    case .expanded: expandedTop
    }
  }

  func clampedTop(_ top: CGFloat) -> CGFloat { min(collapsedTop, max(expandedTop, top)) }

  func nearest(to projectedTop: CGFloat) -> MapPanelDetent {
    // At large text sizes two detents may coincide. Prefer the expanded state
    // so its full content and scrolling remain reachable.
    MapPanelDetent.allCases.reversed().min {
      abs(top(for: $0) - projectedTop) < abs(top(for: $1) - projectedTop)
    } ?? .collapsed
  }

  func collapsedProgress(at top: CGFloat) -> CGFloat {
    let distance = collapsedTop - nearbyTop
    guard distance > 0 else { return 0 }
    return min(1, max(0, (top - nearbyTop) / distance))
  }

  func expandedProgress(at top: CGFloat) -> CGFloat {
    let distance = nearbyTop - expandedTop
    // Large text may merge Nearby with Expanded. Keep the floating-to-edge
    // transition continuous even when that intermediate stop disappears.
    guard distance > 0 else { return 1 - collapsedProgress(at: top) }
    return min(1, max(0, (nearbyTop - top) / distance))
  }

  func horizontalInset(at top: CGFloat) -> CGFloat {
    10 * (1 - expandedProgress(at: top)) + 15 * collapsedProgress(at: top)
  }

  func bottomCornerRadius(at top: CGFloat) -> CGFloat {
    26 * (1 - expandedProgress(at: top))
  }

  func bottomGap(at top: CGFloat) -> CGFloat { max(bottomInset, 29) * collapsedProgress(at: top) }
  func height(at top: CGFloat) -> CGFloat { viewport.height - top - bottomGap(at: top) }
}
