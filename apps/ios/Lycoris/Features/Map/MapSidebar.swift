import SwiftUI

/// Native controls over the persistent map. Content visibility is independent
/// of navigation so closing the second column never removes the first one.
struct MapSidebar: View {
  let showsLabels: Bool
  let selection: MapSidebarDestination
  let contentVisible: Bool
  let user: AccountUser?
  let avatar: Data?
  let onSearch: () -> Void
  let onBookmarks: () -> Void
  let onContribute: () -> Void
  let onSettings: () -> Void
  let onAccount: () -> Void
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @ScaledMetric(relativeTo: .body) private var symbolSize: CGFloat = 20

  private var itemLayout: AnyLayout {
    if showsLabels && dynamicTypeSize.isAccessibilitySize {
      AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
    } else {
      AnyLayout(HStackLayout(spacing: 12))
    }
  }

  var body: some View {
    VStack(spacing: 8) {
      if showsLabels {
        Text("Lycoris Maps").font(.title2.weight(.semibold))
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 16).padding(.top, 20).padding(.bottom, 8)
      } else {
        Image(systemName: "map").font(.title2)
          .foregroundStyle(.secondary).padding(.top, 20).padding(.bottom, 12)
          .accessibilityHidden(true)
      }
      ScrollView {
        VStack(spacing: 8) {
          item("Search", symbol: "magnifyingglass", id: "search",
               selected: contentVisible && selection == .search, action: onSearch)
            .keyboardShortcut("f", modifiers: .command)
          if user != nil {
            item("Bookmarks", symbol: "bookmark", id: "bookmarks",
                 selected: contentVisible && selection == .bookmarks, action: onBookmarks)
          }
          item("Contribute", symbol: "square.and.pencil", id: "contribute", action: onContribute)
          item("Settings", symbol: "gearshape", id: "settings", action: onSettings)
        }.padding(.horizontal, 8)
      }
      .scrollIndicators(.hidden)
      Button(action: onAccount) {
        itemLayout {
          AccountAvatar(user: user, data: avatar, size: 36)
          if showsLabels {
            Text("Account").font(.body)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        }.frame(minHeight: 44).frame(maxWidth: .infinity)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain).padding(8)
      .accessibilityLabel("Account").accessibilityIdentifier("map.sidebar.account")
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .modifier(MapPanelSurface(shape: UnevenRoundedRectangle(cornerRadii: .init(topLeading: 26, bottomLeading: 26, bottomTrailing: 26, topTrailing: 26))))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("map.sidebar.navigation")
  }

  private func item(
    _ title: LocalizedStringKey, symbol: String, id: String, selected: Bool = false,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      itemLayout {
        Image(systemName: symbol).font(.system(size: min(symbolSize, 32)))
          .frame(width: max(24, min(symbolSize, 32)), height: max(24, min(symbolSize, 32)))
        if showsLabels {
          Text(title, tableName: id == "search" ? "AdaptiveMap" : nil).fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      .padding(.horizontal, showsLabels ? 12 : 0).padding(.vertical, 8)
      .frame(maxWidth: .infinity, minHeight: 44)
      .foregroundStyle(selected ? Color.accentColor : Color.primary)
      .background(selected ? Color.accentColor.opacity(0.15) : Color.clear,
                  in: RoundedRectangle(cornerRadius: 14))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain).help(Text(title, tableName: id == "search" ? "AdaptiveMap" : nil))
    .accessibilityLabel(Text(title, tableName: id == "search" ? "AdaptiveMap" : nil))
    .accessibilityAddTraits(selected ? [.isSelected] : [])
    .accessibilityIdentifier("map.sidebar.\(id)")
  }
}
