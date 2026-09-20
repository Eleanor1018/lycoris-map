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

  func horizontalInset(at top: CGFloat) -> CGFloat {
    25 * collapsedProgress(at: top)
  }

  func bottomCornerRadius(at top: CGFloat) -> CGFloat {
    26 * collapsedProgress(at: top)
  }

  func bottomGap(at top: CGFloat) -> CGFloat { max(bottomInset, 29) * collapsedProgress(at: top) }
  func height(at top: CGFloat) -> CGFloat { viewport.height - top - bottomGap(at: top) }

  // MARK: - Grabber geometry

  /// The real, tappable handle is always 44pt tall. The visible in-panel
  /// placeholder shrinks continuously (44 → 14) as the panel collapses so the
  /// search row keeps 14pt above and below at rest.
  static let grabberRealHeight: CGFloat = 44
  static let grabberPlaceholderCollapsedHeight: CGFloat = 14

  /// Height of the in-panel transparent placeholder that reserves the original
  /// 44→14pt layout space.
  func grabberPlaceholderHeight(at top: CGFloat) -> CGFloat {
    let progress = collapsedProgress(at: top)
    return Self.grabberRealHeight
      - (Self.grabberRealHeight - Self.grabberPlaceholderCollapsedHeight) * progress
  }

  /// Center y of the real 44pt handle Button, in the same (offset) coordinate
  /// space as `top(for:)`. Its bottom edge aligns with the placeholder's bottom
  /// edge, so at rest it extends 30pt above the panel onto the map.
  func grabberCenterY(at top: CGFloat) -> CGFloat {
    top + grabberPlaceholderHeight(at: top) - Self.grabberRealHeight / 2
  }

  /// Hit width of the real handle: full panel width when expanded, narrowing to
  /// 88pt when collapsed so the 30pt map overhang does not reach the nearby tools.
  func grabberWidth(at top: CGFloat) -> CGFloat {
    let progress = collapsedProgress(at: top)
    let panelWidth = viewport.width - horizontalInset(at: top) * 2
    return panelWidth * (1 - progress) + 88 * progress
  }
}
