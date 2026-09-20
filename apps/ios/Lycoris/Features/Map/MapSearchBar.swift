import SwiftUI

struct MapSearchBar: View {
  @Binding var query: String
  var focused: FocusState<Bool>.Binding
  let height: CGFloat
  var onSubmit: () -> Void = {}
  var user: AccountUser? = nil
  var avatar: Data? = nil
  var onAccount: () -> Void = {}
  var onVoiceSearch: () -> Void
  var voiceActive = false
  var voiceState: VoiceSearchController.State = .idle
  var language: AppLanguage = .current()
  @ScaledMetric(relativeTo: .headline) private var avatarFont: CGFloat = 18

  private var voiceButton: VoiceSearchButtonState {
    VoiceSearchButtonState(isVoicePanelOpen: voiceActive, state: voiceState)
  }

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
        Button(action: onVoiceSearch) {
          Image(systemName: voiceButton.symbolName).font(.subheadline)
            .foregroundStyle(voiceButton.usesActiveAppearance ? Color.accentColor : Color.secondary)
            .frame(width: 44, height: 44).contentShape(Rectangle())
        }.buttonStyle(.plain)
          .disabled(!voiceButton.isEnabled)
          .accessibilityLabel(voiceButton.label(language: language))
          .accessibilityIdentifier(
            "map.voice")
      }
      .padding(.leading, 12)
      .frame(height: max(44, height))
      .background(.quaternary, in: RoundedRectangle(cornerRadius: 22))

      Button(action: onAccount) {
        AccountAvatar(user: user, data: avatar)
          .frame(width: 44, height: 44).contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Account")
      .accessibilityIdentifier("map.account")
    }
  }
}
