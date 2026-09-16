import SwiftUI

struct AuthenticationView: View {
  @Bindable var store: AccountStore
  let onAuthenticated: () -> Void
  let onClose: () -> Void
  @State private var registering = false

  var body: some View {
    NavigationStack {
      credentials(registering: false)
        .navigationDestination(isPresented: $registering) {
          credentials(registering: true)
        }
    }
    .onChange(of: registering) { _, _ in store.message = nil }
  }

  private func credentials(registering: Bool) -> some View {
    CredentialForm(
      store: store, registering: registering,
      onSwitch: { self.registering.toggle() },
      onAuthenticated: onAuthenticated, onClose: onClose)
  }
}

private struct CredentialForm: View {
  @Bindable var store: AccountStore
  let registering: Bool
  let onSwitch: () -> Void
  let onAuthenticated: () -> Void
  let onClose: () -> Void
  @State private var username = ""
  @State private var email = ""
  @State private var password = ""
  @FocusState private var focus: Field?
  private enum Field { case email, username, password }
  private var unavailable: Bool { store.isBusy || store.isChecking }

  var body: some View {
    Form {
      Section {
        if registering {
          TextField("Email", text: $email)
            .keyboardType(.emailAddress).textContentType(.emailAddress)
            .focused($focus, equals: .email).submitLabel(.next)
            .onSubmit { focus = .username }
            .accessibilityIdentifier("auth.email")
        }
        TextField(registering ? "Username" : "Email or Username", text: $username)
          .textContentType(.username)
          .focused($focus, equals: .username).submitLabel(.next)
          .onSubmit { focus = .password }
          .accessibilityIdentifier("auth.username")
        SecureField("Password", text: $password)
          .textContentType(registering ? .newPassword : .password)
          .focused($focus, equals: .password).submitLabel(.go)
          .onSubmit(submit)
          .accessibilityIdentifier("auth.password")
      } footer: {
        if registering {
          Text("Use at least 4 characters and no more than 72 UTF-8 bytes.")
        }
      }
      .disabled(unavailable)

      if registering {
        Section {
          LabeledContent("Verification Code") {
            Text("Not available yet").foregroundStyle(.secondary)
          }
          .accessibilityIdentifier("auth.verification")
        } footer: {
          Text("Verification is not enabled; no code is required.")
        }
      }

      Section {
        Button(action: submit) {
          HStack {
            Spacer(minLength: 0)
            if unavailable { ProgressView() }
            Text(registering ? "Register" : "Login")
            Spacer(minLength: 0)
          }
        }
        .disabled(!canSubmit || unavailable)
        .accessibilityIdentifier("auth.submit")
        if let message = store.message {
          Text(message).foregroundStyle(.secondary)
            .accessibilityIdentifier("account.message")
        }
      }

      Section {
        Button(action: switchMode) {
          Text(registering ? "Already have an account? Login" : "No account? Register")
        }
        .disabled(unavailable)
        .accessibilityIdentifier("auth.switch")
      } footer: {
        Text("Apple and Google login are not enabled yet. Please use your account password.")
      }
    }
    .autocorrectionDisabled().textInputAutocapitalization(.never)
    .scrollDismissesKeyboard(.interactively)
    .navigationTitle(registering ? "Register" : "Login")
    .navigationBarTitleDisplayMode(.inline)
    .navigationBarBackButtonHidden(store.isBusy)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Close account", systemImage: "xmark", action: onClose)
          .labelStyle(.iconOnly)
          .disabled(store.isBusy)
          .accessibilityIdentifier("account.close")
      }
      ToolbarItemGroup(placement: .keyboard) {
        Spacer()
        Button("Done") { focus = nil }
      }
    }
    .onDisappear {
      password = ""
      focus = nil
    }
  }

  private var canSubmit: Bool {
    let identity = username.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !identity.isEmpty, !password.isEmpty else { return false }
    if !registering { return true }
    return identity.unicodeScalars.count <= 255 && email.contains("@")
      && email.unicodeScalars.count <= 255 && AccountValidation.password(password)
  }

  private func switchMode() {
    password = ""
    focus = nil
    onSwitch()
  }

  private func submit() {
    guard canSubmit, !unavailable else { return }
    focus = nil
    Task {
      let success = await store.authenticate(
        username: username, email: email, password: password, register: registering)
      password = ""
      if success { onAuthenticated() }
    }
  }
}
