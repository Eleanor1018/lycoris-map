import SwiftUI

struct MapSearchBar: View {
  @Binding var query: String
  var focused: FocusState<Bool>.Binding
  let height: CGFloat
  var onSubmit: () -> Void = {}
  var user: AccountUser? = nil
  var avatar: Data? = nil
  var onAccount: () -> Void = {}
  var onUnavailableAction: () -> Void
  @ScaledMetric(relativeTo: .headline) private var avatarFont: CGFloat = 18

  var body: some View {
    HStack(spacing: 8) {
      HStack(spacing: 4) {
        Image("Search").resizable().frame(width: 18, height: 18)
          .accessibilityHidden(true)
        TextField("Search Maps", text: $query)
          .font(.subheadline.weight(.medium))
          .focused(focused)
          .submitLabel(.search)
          .autocorrectionDisabled()
          .textInputAutocapitalization(.never)
          .onSubmit {
            focused.wrappedValue = false
            onSubmit()
          }
          .accessibilityIdentifier("map.search")
        Button(action: onUnavailableAction) {
          Image(systemName: "microphone").font(.subheadline).foregroundStyle(.secondary)
        }.buttonStyle(.plain).accessibilityLabel("Voice search")
      }
      .padding(.horizontal, 12)
      .frame(height: height)
      .background(.quaternary, in: RoundedRectangle(cornerRadius: 22))

      Button(action: onAccount) {
        AccountAvatar(user: user, data: avatar)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Account")
      .accessibilityIdentifier("map.account")
    }
  }
}
