import SwiftUI

struct PlaceLinkSheet: View {
  let link: PlaceLink
  let account: AccountStore
  let onOpen: (Marker, Bool) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var failure: String?
  @State private var attempt = 0

  var body: some View {
    NavigationStack {
      Group {
        if let failure {
          ContentUnavailableView {
            Label("Place unavailable", systemImage: "mappin.slash")
          } description: {
            Text(failure)
          } actions: {
            Button("Try again") { attempt += 1 }
          }
        } else {
          ProgressView("Loading places…")
        }
      }
      .navigationTitle("Lycoris Maps").navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
      .task(id: attempt) { await load() }
    }
  }

  private func load() async {
    failure = nil
    do {
      // Public links do not require login and never send session cookies.
      let marker = try await MarkerAPI().detail(id: link.id, language: account.language)
      try Task.checkCancellation()
      onOpen(marker, false)
    } catch {
      guard !Task.isCancelled else { return }
      let unavailable = (error as? MarkerRequestFailure)?.failure == .unavailable
      guard unavailable else {
        failure = PlaceFailure.requestFailed.message
        return
      }
      if !account.hasVerifiedIdentity { await account.restore() }
      // A cold launch can already be restoring the session.
      for _ in 0..<150 where account.isChecking {
        if Task.isCancelled { return }
        try? await Task.sleep(for: .milliseconds(100))
      }
      guard !Task.isCancelled else { return }
      guard let owner = account.user?.publicId else {
        failure = PlaceFailure.unavailable.message
        return
      }
      let token = account.epoch
      do {
        let data = try await account.contributionRequest(
          AccountRequest(path: "api/markers/\(link.id)", query: ["lang": account.language]),
          owner: owner, token: token)
        let marker = try JSONDecoder().decode(Marker.self, from: data)
        try Task.checkCancellation()
        guard marker.id == link.id, marker.point != nil else { throw PlaceFailure.invalidResponse }
        guard account.epoch == token, account.user?.publicId == owner else { return }
        onOpen(marker, true)
      } catch {
        guard !Task.isCancelled else { return }
        failure =
          (error as? AccountFailure)?.status == 404
          ? PlaceFailure.unavailable.message : PlaceFailure.requestFailed.message
      }
    }
  }
}
