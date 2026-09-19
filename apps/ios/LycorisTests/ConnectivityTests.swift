import Testing

@testable import Lycoris

@MainActor struct ConnectivityTests {
  @Test func recoveryRequiresAnUnavailableToAvailableTransition() {
    let monitor = ConnectivityMonitor()
    monitor.update(isAvailable: true)
    monitor.update(isAvailable: true)
    #expect(monitor.recoveryCount == 0)
    monitor.update(isAvailable: false)
    monitor.update(isAvailable: false)
    monitor.update(isAvailable: true)
    monitor.update(isAvailable: true)
    #expect(monitor.recoveryCount == 1)
    monitor.update(isAvailable: false)
    monitor.stop()
    monitor.update(isAvailable: true)
    #expect(monitor.recoveryCount == 1)
  }
}
