import Foundation
import Observation

@MainActor @Observable
final class AccountStore {
  private let api: any AccountServing
  private(set) var user: AccountUser?
  private(set) var isChecking = false
  private(set) var isBusy = false
  private(set) var hasChecked = false
  private(set) var epoch = UUID()
  var message: String?
  private(set) var bookmarks: [Marker] = []
  private(set) var created: [Marker] = []
  private(set) var libraryLoading = false
  private(set) var libraryMessage: String?
  private(set) var avatar: Data?
  private(set) var selectedMarker: Marker?
  private(set) var selectedPhoto: Data?
  private(set) var photoFailed = false
  private(set) var detailState: PlaceStore.LoadState = .idle
  private var libraryGeneration = UUID()
  private var detailGeneration = UUID()
  private var identityGeneration = UUID()
  private var libraryTask: Task<Void, Never>?
  private var detailTask: Task<Void, Never>?

  var baseURL: URL? { api.baseURL }
  var language: String { Locale.current.language.languageCode?.identifier == "zh" ? "zh" : "en" }

  init(api: any AccountServing = AccountAPI()) { self.api = api }

  func restore() async {
    guard !isBusy, !isChecking else { return }
    isChecking = true
    let token = epoch
    let generation = identityGeneration
    defer {
      isChecking = false
      hasChecked = true
    }
    do {
      let value = try await api.user()
      guard token == epoch, generation == identityGeneration else { return }
      accept(value)
      message = nil
      reloadLibrary()
    } catch {
      guard token == epoch, generation == identityGeneration else { return }
      if (error as? AccountFailure)?.status == 401 {
        expire()
      } else {
        message = failureMessage(error)
      }
    }
  }

  /// Auth and account writes are serialized. A dismissed sheet cannot cancel a cookie-changing request.
  func authenticate(username: String, email: String, password: String, register: Bool) async -> Bool
  {
    guard !isBusy else { return false }
    isBusy = true
    invalidatePrivateData()
    user = nil
    message = nil
    defer {
      isBusy = false
      hasChecked = true
    }
    do {
      var fields = [
        "username": username.trimmingCharacters(in: .whitespacesAndNewlines), "password": password,
      ]
      if register { fields["email"] = email.trimmingCharacters(in: .whitespacesAndNewlines) }
      _ = try await api.user(.json(register ? "api/register" : "api/login", fields: fields))
      // Verify the cookie, rather than trusting only the login response body.
      let current = try await api.user()
      accept(current)
      reloadLibrary()
      return true
    } catch {
      await reconcile()
      let failure = error as? AccountFailure
      if !register && failure?.status == 401 {
        message = String(localized: "The username or password is incorrect.")
      } else if register && failure?.status == 503 {
        message = String(
          localized:
            "Registration could not be confirmed. Your account may have been created; try logging in."
        )
      } else if register && failure?.status == 400 {
        message = String(
          localized: "Check your details. That username or email may already be in use.")
      } else {
        message = failureMessage(error)
      }
      return false
    }
  }

  func logout() async {
    guard !isBusy else { return }
    isBusy = true
    invalidatePrivateData()
    message = nil
    defer { isBusy = false }
    do {
      _ = try await api.send(AccountRequest(path: "api/logout", method: "POST"))
      await reconcile()
      if user != nil {
        message = String(localized: "Logout could not be confirmed. Please try again.")
      }
    } catch {
      await reconcile()
      if user != nil {
        message = String(localized: "Logout could not be confirmed. Please try again.")
      }
    }
  }

  func updateProfile(nickname: String, pronouns: String, signature: String) async -> Bool {
    await writeUser {
      try await self.api.user(
        .json(
          "api/me", method: "PATCH",
          fields: [
            "nickname": nickname, "pronouns": pronouns, "signature": signature,
          ]))
    }
  }

  func updateAvatar(_ data: Data) async -> Bool {
    await writeUser {
      let jpeg = try AvatarEncoder.jpeg(from: data)
      let boundary = "Lycoris-\(UUID().uuidString)"
      var body = Data(
        "--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"avatar.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n"
          .utf8)
      body.append(jpeg)
      body.append(Data("\r\n--\(boundary)--\r\n".utf8))
      return try await self.api.user(
        AccountRequest(
          path: "api/me/avatar", method: "POST", body: body,
          contentType: "multipart/form-data; boundary=\(boundary)"))
    }
  }

  func changePassword(old: String, new: String) async -> Bool {
    guard !isBusy, let owner = user?.publicId else { return false }
    let token = epoch
    isBusy = true
    identityGeneration = UUID()
    message = nil
    defer { isBusy = false }
    do {
      try await verifyOwner(owner, token: token)
      _ = try await api.send(
        .json("api/me/password", fields: ["oldPassword": old, "newPassword": new]))
      invalidatePrivateData()
      let verified = await reconcile()
      if verified {
        message =
          user == nil
          ? String(localized: "Password changed. Please log in again.")
          : String(localized: "Password changed.")
      } else {
        message = String(
          localized:
            "Password changed, but the session could not be checked. Please check your connection.")
      }
      return true
    } catch {
      guard matches(owner, token) else { return false }
      if (error as? AccountFailure)?.status == 401 { expire() }
      message =
        (error as? AccountFailure)?.status == 400
        ? String(localized: "Check your current password and the new password.")
        : String(
          localized:
            "The password change could not be confirmed. Check your connection, then try logging in before retrying."
        )
      await reconcile()
      return false
    }
  }

  func isBookmarked(_ id: Int64) -> Bool { bookmarks.contains { $0.id == id } }

  func toggleBookmark(_ id: Int64) async {
    guard id > 0, !isBusy, let owner = user?.publicId else { return }
    let token = epoch
    let saved = isBookmarked(id)
    isBusy = true
    identityGeneration = UUID()
    message = nil
    defer { isBusy = false }
    do {
      try await verifyOwner(owner, token: token)
      _ = try await api.send(
        AccountRequest(path: "api/markers/\(id)/favorite", method: saved ? "DELETE" : "POST"))
      guard owner == user?.publicId, token == epoch else { return }
      // Re-read the authoritative list; never claim a failed write succeeded.
      await loadLibrary()
    } catch { if matches(owner, token) { handle(error, owner: owner) } }
  }

  func reloadLibrary() {
    libraryTask?.cancel()
    let generation = UUID()
    libraryGeneration = generation
    libraryTask = Task { await readLibrary(generation: generation) }
  }

  func loadLibrary() async {
    libraryTask?.cancel()
    let generation = UUID()
    libraryGeneration = generation
    await readLibrary(generation: generation)
  }

  private func readLibrary(generation: UUID) async {
    guard let owner = user?.publicId, generation == libraryGeneration else { return }
    let token = epoch
    libraryLoading = true
    libraryMessage = nil
    defer { if generation == libraryGeneration { libraryLoading = false } }
    do {
      let values = try await api.places("api/markers/me/favorites/details", language: language)
      guard matches(owner, token), generation == libraryGeneration else { return }
      bookmarks = values
      let own = try await api.places("api/markers/me/created", language: language)
      guard matches(owner, token), generation == libraryGeneration else { return }
      created = own
      if user?.avatarUrl != nil {
        do {
          let bytes = try await api.send(AccountRequest(path: "api/me/avatar"))
          guard matches(owner, token), generation == libraryGeneration else { return }
          avatar = bytes
        } catch {
          guard matches(owner, token), generation == libraryGeneration else { return }
          if (error as? AccountFailure)?.status == 401 { handle(error, owner: owner) }
          // An unavailable avatar falls back to initials without hiding the library.
          avatar = nil
        }
      } else {
        avatar = nil
      }
    } catch {
      guard matches(owner, token), generation == libraryGeneration, !Task.isCancelled else {
        return
      }
      handle(error, owner: owner)
      libraryMessage = failureMessage(error)
    }
  }

  func select(_ marker: Marker) {
    closeDetail()
    guard let owner = user?.publicId else { return }
    let token = epoch
    let generation = detailGeneration
    selectedMarker = marker
    detailState = .loading
    detailTask = Task {
      do {
        let data = try await api.send(
          AccountRequest(path: "api/markers/\(marker.id)", query: ["lang": language]))
        let current = try JSONDecoder().decode(Marker.self, from: data)
        guard current.id == marker.id, current.point != nil else {
          throw AccountFailure(status: 502)
        }
        guard matches(owner, token), generation == detailGeneration else { return }
        selectedMarker = current
        detailState = .loaded
        if let url = PlacePresentation.imageURL(current.markImage, baseURL: api.baseURL) {
          do {
            let bytes = try await api.send(AccountRequest(path: String(url.path.dropFirst())))
            guard matches(owner, token), generation == detailGeneration else { return }
            selectedPhoto = bytes
          } catch {
            guard matches(owner, token), generation == detailGeneration else { return }
            handle(error, owner: owner)
            photoFailed = true
          }
        }
      } catch {
        guard matches(owner, token), generation == detailGeneration else { return }
        handle(error, owner: owner)
        if (error as? AccountFailure)?.status == 404 {
          libraryTask?.cancel()
          libraryGeneration = UUID()
          bookmarks.removeAll { $0.id == marker.id }
          created.removeAll { $0.id == marker.id }
          reloadLibrary()
        }
        detailState = .failed(
          (error as? AccountFailure)?.status == 404 ? .unavailable : .requestFailed)
      }
    }
  }

  func closeDetail() {
    detailTask?.cancel()
    detailGeneration = UUID()
    selectedMarker = nil
    selectedPhoto = nil
    photoFailed = false
    detailState = .idle
  }

  private func writeUser(_ operation: () async throws -> AccountUser) async -> Bool {
    guard !isBusy, let owner = user?.publicId else { return false }
    let token = epoch
    isBusy = true
    identityGeneration = UUID()
    message = nil
    defer { isBusy = false }
    do {
      try await verifyOwner(owner, token: token)
      let updated = try await operation()
      guard matches(owner, token) else { return false }
      guard updated.publicId == owner else { throw AccountFailure(status: 401) }
      user = updated
      avatar = nil
      reloadLibrary()
      return true
    } catch {
      guard matches(owner, token) else { return false }
      handle(error, owner: owner)
      if (error as? AccountFailure)?.status == 409 { await reconcile() }
      return false
    }
  }

  private func verifyOwner(_ owner: String, token: UUID) async throws {
    let current = try await api.user()
    guard matches(owner, token) else { throw CancellationError() }
    guard current.publicId == owner else {
      accept(current)
      reloadLibrary()
      message = AccountFailure(status: 409).message
      throw AccountFailure(status: 409)
    }
    user = current
  }

  @discardableResult private func reconcile() async -> Bool {
    do {
      accept(try await api.user())
      reloadLibrary()
      return true
    } catch {
      if (error as? AccountFailure)?.status == 401 {
        expire()
        return true
      } else {
        message = failureMessage(error)
        return false
      }
    }
  }

  private func accept(_ value: AccountUser) {
    if user?.publicId != value.publicId { invalidatePrivateData() }
    user = value
  }

  private func matches(_ owner: String, _ token: UUID) -> Bool {
    user?.publicId == owner && epoch == token
  }
  private func expire() {
    invalidatePrivateData()
    user = nil
  }

  private func invalidatePrivateData() {
    epoch = UUID()
    identityGeneration = UUID()
    libraryTask?.cancel()
    libraryGeneration = UUID()
    libraryLoading = false
    libraryMessage = nil
    bookmarks = []
    created = []
    avatar = nil
    closeDetail()
  }

  private func handle(_ error: Error, owner: String) {
    guard user?.publicId == owner else { return }
    if (error as? AccountFailure)?.status == 401 { expire() }
    message = failureMessage(error)
  }

  private func failureMessage(_ error: Error) -> String {
    (error as? AccountFailure)?.message ?? AccountFailure(status: 0).message
  }
}
