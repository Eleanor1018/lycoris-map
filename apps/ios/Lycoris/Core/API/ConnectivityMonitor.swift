import Foundation
import Network
import Observation

/// Connectivity is observed for recovery, never used to block the first request.
/// iOS presents any applicable per-app network permission UI for that request.
@MainActor @Observable
final class ConnectivityMonitor {
  private(set) var recoveryCount = 0
  @ObservationIgnored private var monitor: NWPathMonitor?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var wasUnavailable = false

  func start() {
    guard monitor == nil else { return }
    let monitor = NWPathMonitor()
    self.monitor = monitor
    let token = generation
    monitor.pathUpdateHandler = { [weak self] path in
      let available = path.status == .satisfied
      Task { @MainActor [weak self] in
        guard let self, self.generation == token else { return }
        self.update(isAvailable: available)
      }
    }
    monitor.start(queue: DispatchQueue(label: "com.lycoris.maps.connectivity"))
  }

  func update(isAvailable: Bool) {
    if isAvailable && wasUnavailable { recoveryCount += 1 }
    wasUnavailable = !isAvailable
  }

  func stop() {
    generation = UUID()
    monitor?.cancel()
    monitor = nil
    wasUnavailable = false
  }
}
