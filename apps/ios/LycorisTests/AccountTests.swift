import Foundation
import ImageIO
import Testing

@testable import Lycoris

@MainActor
struct AccountTests {
  private func waitFor(_ condition: () async -> Bool) async throws {
    for _ in 0..<200 {
      if await condition() { return }
      try await Task.sleep(for: .milliseconds(5))
    }
    Issue.record("Account state did not settle")
  }

  @Test func lateProfileSuccessCannotRestoreExpiredIdentity() async throws {
    let api = AccountFixture()
    let store = AccountStore(api: api)
    await store.restore()
    await store.loadLibrary()
    await api.hold("PATCH api/me")
    let saving = Task { await store.updateProfile(nickname: "New", pronouns: "", signature: "") }
    try await waitFor { await api.hasPending }
    await api.expireLibrary()
    await store.loadLibrary()
    #expect(store.user == nil)
    await api.release()
    #expect(await saving.value == false)
    #expect(store.user == nil && store.bookmarks.isEmpty)
  }

  @Test func oldRestoreCannotOverwriteSavedProfile() async throws {
    let api = AccountFixture()
    let store = AccountStore(api: api)
    await store.restore()
    await api.hold("GET api/me")
    let restoring = Task { await store.restore() }
    try await waitFor { await api.hasPending }
    #expect(await store.updateProfile(nickname: "New", pronouns: "", signature: ""))
    #expect(store.user?.nickname == "New")
    await api.release()
    await restoring.value
    #expect(store.user?.nickname == "New")
  }

  @Test func latePrivatePhotoCannotReturnAfterLogout() async throws {
    let api = AccountFixture()
    let store = AccountStore(api: api)
    await store.restore()
    await store.loadLibrary()
    let marker = try #require(store.bookmarks.first)
    await api.hold("GET uploads/markers/fixture.jpg")
    store.select(marker)
    try await waitFor { await api.hasPending }
    #expect(store.selectedMarker != nil)
    await store.logout()
    await api.release()
    await Task.yield()
    #expect(store.selectedMarker == nil && store.selectedPhoto == nil && store.avatar == nil)
  }

  @Test func authTransitionsCannotOverlap() async throws {
    let api = AccountFixture()
    let store = AccountStore(api: api)
    await api.hold("POST api/login")
    let login = Task {
      await store.authenticate(username: "account-b", email: "", password: "test", register: false)
    }
    try await waitFor { await api.hasPending }
    await store.logout()
    #expect(await api.logoutWrites == 0)
    await api.release()
    #expect(await login.value)
    #expect(store.user?.publicId == "account-b")
  }

  @Test func outageKeepsIdentityButUnauthorizedClearsEveryPrivateValue() async throws {
    let api = AccountFixture()
    let store = AccountStore(api: api)
    await store.restore()
    await store.loadLibrary()
    #expect(store.user?.publicId == "account-a")
    #expect(store.bookmarks.count == 1)
    await api.setFailure(503)
    await store.restore()
    #expect(store.user?.publicId == "account-a")
    #expect(store.message != nil)
    await api.setFailure(401)
    await store.restore()
    #expect(store.user == nil && store.bookmarks.isEmpty && store.created.isEmpty)
    #expect(store.avatar == nil && store.selectedMarker == nil)
  }

  @Test func delayedOldBookmarksCannotReturnAfterLogoutAndLogin() async throws {
    let api = AccountFixture()
    let store = AccountStore(api: api)
    await store.restore()
    await store.loadLibrary()
    await api.holdFavorites()
    let read = Task { await store.loadLibrary() }
    await api.waitUntilHeld()
    await store.logout()
    #expect(store.user == nil && store.bookmarks.isEmpty)
    let success = await store.authenticate(
      username: "account-b", email: "", password: "test", register: false)
    #expect(success && store.user?.publicId == "account-b")
    await store.loadLibrary()
    await api.releaseFavorites()
    await read.value
    #expect(store.bookmarks.isEmpty)
  }

  @Test func failedLogoutDoesNotClaimAnonymous() async {
    let api = AccountFixture()
    let store = AccountStore(api: api)
    await store.restore()
    await api.failLogout()
    await store.logout()
    #expect(store.user?.publicId == "account-a")
    #expect(store.message == String(localized: "Logout could not be confirmed. Please try again."))
  }

  @Test func identityRecheckPreventsWriteAsAnotherAccount() async {
    let api = AccountFixture()
    let store = AccountStore(api: api)
    await store.restore()
    await api.switchUser("account-b")
    let saved = await store.updateProfile(nickname: "Do not write", pronouns: "", signature: "")
    #expect(!saved && store.user?.publicId == "account-b")
    #expect(await api.profileWrites == 0)
  }

  @Test func emptyFavoriteResponseRefreshesListAndPasswordClearCookieExpiresSession() async {
    let api = AccountFixture()
    let store = AccountStore(api: api)
    await store.restore()
    await store.loadLibrary()
    #expect(store.isBookmarked(1))
    await store.toggleBookmark(1)
    #expect(!store.isBookmarked(1))
    #expect(await store.changePassword(old: "old", new: "new1"))
    #expect(store.user == nil && store.bookmarks.isEmpty)
    #expect(store.message == String(localized: "Password changed. Please log in again."))
  }

  @Test func passwordAndProfileLimitsMatchRustUnits() {
    #expect(AccountValidation.password("😀😀"))
    #expect(!AccountValidation.password("😀"))
    #expect(AccountValidation.password(String(repeating: "a", count: 72)))
    #expect(!AccountValidation.password(String(repeating: "é", count: 37)))
    #expect(
      AccountValidation.profile(
        nickname: "", pronouns: "", signature: String(repeating: "a", count: 200)))
    #expect(
      !AccountValidation.profile(
        nickname: "", pronouns: "", signature: String(repeating: "a", count: 201)))
  }

  @Test func avatarConvertsToSmallJPEGAndRejectsInvalidInput() throws {
    let png = Data(
      base64Encoded:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII="
    )!
    let jpeg = try AvatarEncoder.jpeg(from: png)
    #expect(jpeg.starts(with: [0xff, 0xd8]))
    let source = try #require(CGImageSourceCreateWithData(jpeg as CFData, nil))
    let image = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
    #expect(image.width == 1 && image.height == 1)
    #expect(throws: AccountFailure(status: 400)) {
      try AvatarEncoder.jpeg(from: Data("invalid".utf8))
    }
  }
}

private actor AccountFixture: AccountServing {
  nonisolated let baseURL = URL(string: "https://accounts.example.test")
  var identity: String? = "account-a"
  var failure: Int?
  var logoutFails = false
  var favorite = true
  var shouldHold = false
  var held: CheckedContinuation<Data, Never>?
  var ready: CheckedContinuation<Void, Never>?
  var holdRequest: String?
  var pending: CheckedContinuation<Data, Never>?
  var pendingData = Data()
  var libraryExpired = false
  var nickname: String?
  private(set) var logoutWrites = 0
  var hasPending: Bool { pending != nil }
  func hold(_ request: String) { holdRequest = request }
  func release() {
    pending?.resume(returning: pendingData)
    pending = nil
  }
  func expireLibrary() { libraryExpired = true }
  private(set) var profileWrites = 0
  func setFailure(_ value: Int) { failure = value }
  func failLogout() { logoutFails = true }
  func switchUser(_ id: String) { identity = id }
  func holdFavorites() { shouldHold = true }
  func waitUntilHeld() async {
    if held != nil { return }
    await withCheckedContinuation { ready = $0 }
  }
  func releaseFavorites() {
    held?.resume(returning: Data(Self.markers.utf8))
    held = nil
  }
  static let markers =
    #"[{"id":1,"version":1,"lat":31,"lng":121,"category":"accessible_toilet","title":"Owned place","contentLanguage":"en","isPublic":false,"reviewStatus":"PENDING"}]"#

  func send(_ request: AccountRequest) async throws -> Data {
    let data = try await response(request)
    if holdRequest == "\(request.method) \(request.path)" {
      holdRequest = nil
      pendingData = data
      return await withCheckedContinuation { pending = $0 }
    }
    return data
  }

  private func response(_ request: AccountRequest) async throws -> Data {
    switch request.path {
    case "api/me":
      if let failure { throw AccountFailure(status: failure) }
      guard let identity else { throw AccountFailure(status: 401) }
      if request.method == "PATCH" {
        profileWrites += 1
        nickname = try JSONDecoder().decode([String: String].self, from: request.body!)["nickname"]
      }
      return Data(
        "{\"code\":0,\"data\":{\"publicId\":\"\(identity)\",\"username\":\"\(identity)\",\"nickname\":\"\(nickname ?? identity)\"}}"
          .utf8)
    case "api/login":
      let fields = try JSONDecoder().decode([String: String].self, from: request.body!)
      identity = fields["username"]
      return try await send(AccountRequest(path: "api/me"))
    case "api/logout":
      logoutWrites += 1
      if logoutFails { throw AccountFailure(status: 503) }
      identity = nil
      return Data(#"{"code":0,"data":null}"#.utf8)
    case "api/me/password":
      identity = nil
      return Data(#"{"code":0,"data":null}"#.utf8)
    case "api/markers/me/favorites/details":
      if libraryExpired { throw AccountFailure(status: 401) }
      if shouldHold {
        shouldHold = false
        return await withCheckedContinuation {
          held = $0
          ready?.resume()
          ready = nil
        }
      }
      return Data((identity == "account-a" && favorite ? Self.markers : "[]").utf8)
    case "api/markers/me/created": return Data("[]".utf8)
    case "api/markers/1":
      return Data(
        #"{"id":1,"version":1,"lat":31,"lng":121,"category":"accessible_toilet","title":"Owned place","contentLanguage":"en","isPublic":false,"reviewStatus":"PENDING","markImage":"/uploads/markers/fixture.jpg"}"#
          .utf8)
    case "uploads/markers/fixture.jpg": return Data([1, 2, 3])
    case "api/markers/1/favorite":
      favorite = request.method == "POST"
      return Data()
    default: throw AccountFailure(status: 404)
    }
  }
}
