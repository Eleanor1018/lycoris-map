import SwiftUI

struct AuthenticationView: View {
  @Bindable var store: AccountStore
  let onAuthenticated: () -> Void
  let onClose: () -> Void
  @State private var registering = false
  @State private var username = ""
  @State private var email = ""
  @State private var password = ""
  @State private var unavailable = false
  @FocusState private var focus: Field?
  @ScaledMetric(relativeTo: .title) private var titleSize: CGFloat = 32
  @ScaledMetric(relativeTo: .title3) private var labelSize: CGFloat = 20
  private enum Field { case email, username, password }
  private let plum = Color(red: 90 / 255, green: 56 / 255, blue: 80 / 255)
  static let background = Color(red: 232 / 255, green: 222 / 255, blue: 248 / 255)

  var body: some View {
    ScrollView {
      VStack(spacing: 22) {
        HStack(alignment: .top) {
          Text(registering ? "Register" : "Login")
            .font(.system(size: titleSize)).frame(maxWidth: .infinity, alignment: .leading)
          Button(action: onClose) {
            Image("AuthClose").resizable().frame(width: 24, height: 24).frame(width: 44, height: 44)
          }.accessibilityLabel("Close account").accessibilityIdentifier("account.close")
        }
        .padding(.leading, 11)

        VStack(alignment: .leading, spacing: 22) {
          if registering {
            field("Email", field: .email) {
              TextField("", text: $email).keyboardType(.emailAddress).textContentType(.emailAddress)
                .focused($focus, equals: .email).accessibilityIdentifier("auth.email")
            }
          }
          field(registering ? "Username" : "Email or Username", field: .username) {
            TextField("", text: $username).textContentType(.username)
              .focused($focus, equals: .username).accessibilityIdentifier("auth.username")
          }
          field("Password", field: .password) {
            SecureField("", text: $password).textContentType(registering ? .newPassword : .password)
              .focused($focus, equals: .password).accessibilityIdentifier("auth.password")
          }
          if registering && !password.isEmpty && !AccountValidation.password(password) {
            Text("Password is too short or too long. Use at least 4 characters, up to 72 bytes.")
              .font(.caption)
          }
          if registering {
            VStack(alignment: .leading, spacing: 11) {
              Text("Verification Code").font(.system(size: labelSize, weight: .medium))
              TextField("Not available yet", text: .constant(""))
                .disabled(true).inputSurface().accessibilityLabel(
                  "Verification Code, not available yet")
              Text("Verification is not enabled; no code is required.")
                .font(.caption).foregroundStyle(plum.opacity(0.8))
            }.padding(.top, 11)
          }
        }.padding(.horizontal, 11)

        Button {
          registering.toggle()
          password = ""
          store.message = nil
          focus = nil
        } label: {
          Text(registering ? "Already have an account? Login" : "No account? Register")
            .font(.caption).underline().frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 11).accessibilityIdentifier("auth.switch")
        .disabled(store.isBusy)

        if let message = store.message {
          Text(message).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 11).accessibilityIdentifier("account.message")
        }

        Button(action: submit) {
          HStack(spacing: 10) {
            if store.isBusy { ProgressView().tint(plum) }
            Text(registering ? "Register" : "Login")
              .font(.system(size: labelSize, weight: .medium))
            Image("AuthLogin").resizable().frame(width: 24, height: 24)
          }
          .padding(.horizontal, 22).padding(.vertical, 9)
          .frame(minWidth: 208, minHeight: 44)
          .background(Color(red: 239 / 255, green: 184 / 255, blue: 200 / 255), in: Capsule())
          .overlay { Capsule().strokeBorder(plum, lineWidth: 1) }
        }
        .disabled(!canSubmit || store.isBusy || store.isChecking)
        .accessibilityIdentifier("auth.submit")

        Text("OR").font(.system(size: titleSize))
        VStack(spacing: 11) {
          provider(
            "Continue with Apple", image: "AuthApple", background: .black, foreground: .white)
          provider(
            "Continue with Google", image: "AuthGoogle", background: .white,
            foreground: Color(red: 117 / 255, green: 117 / 255, blue: 117 / 255))
        }.padding(.horizontal, 11)
      }
      .padding(.top, 14).padding(.bottom, 22)
      .foregroundStyle(plum)
    }
    .background(Self.background)
    .scrollDismissesKeyboard(.interactively)
    .autocorrectionDisabled().textInputAutocapitalization(.never)
    .buttonStyle(.plain)
    .onSubmit { submit() }
    .alert("Not available yet", isPresented: $unavailable) {
      Button("OK", role: .cancel) {}
    } message: {
      Text("Apple and Google login are not enabled yet. Please use your account password.")
    }
  }

  private var canSubmit: Bool {
    let identity = username.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !identity.isEmpty, !password.isEmpty else { return false }
    if !registering { return true }
    return identity.unicodeScalars.count <= 255 && email.contains("@")
      && email.unicodeScalars.count <= 255 && AccountValidation.password(password)
  }

  private func submit() {
    guard canSubmit, !store.isBusy else { return }
    focus = nil
    Task {
      let success = await store.authenticate(
        username: username, email: email, password: password, register: registering)
      password = ""
      if success { onAuthenticated() }
    }
  }

  private func field<Content: View>(
    _ title: LocalizedStringKey, field: Field, @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 11) {
      Text(title).font(.system(size: labelSize, weight: .medium))
      content().accessibilityLabel(Text(title)).inputSurface()
        .overlay {
          RoundedRectangle(cornerRadius: 22).strokeBorder(plum, lineWidth: focus == field ? 2 : 0)
        }
    }
  }

  private func provider(
    _ title: LocalizedStringKey, image: String, background: Color, foreground: Color
  ) -> some View {
    Button {
      unavailable = true
    } label: {
      Text(title).font(.system(size: labelSize, weight: .medium))
        .multilineTextAlignment(.center)
        .padding(.horizontal, 43).padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: 44)
        .overlay(alignment: .leading) {
          Image(image).resizable().frame(width: 24, height: 24).padding(.leading, 13)
        }
        .foregroundStyle(foreground).background(background, in: RoundedRectangle(cornerRadius: 24))
    }.disabled(store.isBusy)
  }
}

extension View {
  fileprivate func inputSurface() -> some View {
    font(.body).padding(.horizontal, 16).padding(.vertical, 11).frame(minHeight: 44)
      .background(
        Color(red: 250 / 255, green: 252 / 255, blue: 249 / 255),
        in: RoundedRectangle(cornerRadius: 22)
      )
      .overlay { RoundedRectangle(cornerRadius: 22).strokeBorder(.white, lineWidth: 1) }
      .shadow(color: .black.opacity(0.04), radius: 32, y: 4)
  }
}
