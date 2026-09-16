import SwiftUI

struct MapSearchBar: View {
  @Binding var query: String
  var focused: FocusState<Bool>.Binding
  let height: CGFloat

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
          .onSubmit { focused.wrappedValue = false }
          .accessibilityIdentifier("map.search")
        Image(systemName: "microphone")
          .font(.subheadline).foregroundStyle(.secondary)
          .accessibilityHidden(true)
      }
      .padding(.horizontal, 12)
      .frame(height: height)
      .background(.quaternary, in: RoundedRectangle(cornerRadius: 22))

      Text("AA")
        .font(.headline.bold()).foregroundStyle(.white)
        .frame(width: 38, height: 38)
        .background(
          LinearGradient(
            colors: [Color("AvatarTop"), Color("AvatarBottom")], startPoint: .top, endPoint: .bottom
          ),
          in: Circle()
        )
        .accessibilityLabel("Account")
        .accessibilityIdentifier("map.avatar.placeholder")
    }
  }
}
