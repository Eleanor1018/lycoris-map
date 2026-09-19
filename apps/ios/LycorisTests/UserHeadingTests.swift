import CoreLocation
import Testing
import UIKit

@testable import Lycoris

struct UserHeadingTests {
  @Test func bearingsUseTrueNorthAndStayRelativeToTheRotatedMap() throws {
    let north = try #require(UserHeading(trueHeading: 0, magneticHeading: 15, accuracy: 5))
    #expect(north.degrees == 0)
    #expect(abs(north.rotation(relativeTo: 90) + .pi / 2) < 0.0001)
    let acrossNorth = try #require(UserHeading(trueHeading: 359, magneticHeading: 10, accuracy: 5))
    #expect(abs(acrossNorth.rotation(relativeTo: 1) + 2 * .pi / 180) < 0.0001)
    let magnetic = try #require(UserHeading(trueHeading: -1, magneticHeading: 80, accuracy: 20))
    #expect(magnetic.degrees == 80)
    #expect(magnetic.rotation(relativeTo: 80) == 0)
    #expect(UserHeading(trueHeading: 90, magneticHeading: 90, accuracy: -1) == nil)
    #expect(UserHeading(trueHeading: -1, magneticHeading: -1, accuracy: 0) == nil)
    #expect(UserHeading(trueHeading: .nan, magneticHeading: .infinity, accuracy: 5) == nil)
    #expect(UserHeading(trueHeading: 0, magneticHeading: 0, accuracy: .nan) == nil)
  }

  @Test func orientationFollowsTheInterfaceRatherThanAnUnlockedPhysicalDevice() {
    #expect(UserHeading.orientation(for: .portrait) == .portrait)
    #expect(UserHeading.orientation(for: .portraitUpsideDown) == .portraitUpsideDown)
    #expect(UserHeading.orientation(for: .landscapeLeft) == .landscapeRight)
    #expect(UserHeading.orientation(for: .landscapeRight) == .landscapeLeft)
  }

  @MainActor @Test func unsupportedHardwareAndDeniedPermissionNeverStartSensors() {
    let source = TestHeadingSource()
    let unsupported = UserHeadingProvider(source: source, isAvailable: { false })
    unsupported.update(enabled: true, orientation: .portrait)
    unsupported.receive(trueHeading: 10, magneticHeading: 15, accuracy: 5, timestamp: Date())
    #expect(source.locationStarts == 0 && source.headingStarts == 0)
    #expect(unsupported.heading == nil)

    let denied = TestHeadingSource()
    denied.authorizationStatus = .denied
    let provider = UserHeadingProvider(source: denied, isAvailable: { true })
    provider.update(enabled: true, orientation: .portrait)
    #expect(denied.locationStarts == 0 && denied.headingStarts == 0)
  }

  @MainActor @Test func foregroundAndPermissionChangesStopAndRestartBothStreams() throws {
    let source = TestHeadingSource()
    let provider = UserHeadingProvider(source: source, isAvailable: { true })
    let manager = CLLocationManager()
    provider.update(enabled: false, orientation: .portrait)
    #expect(source.headingStarts == 0)
    provider.update(enabled: true, orientation: .portrait)
    provider.update(enabled: true, orientation: .portrait)
    #expect(source.locationStarts == 1 && source.headingStarts == 1)
    provider.receive(trueHeading: 20, magneticHeading: 25, accuracy: 5, timestamp: Date())
    #expect(try #require(provider.heading).degrees == 20)

    let previousTimestamp = Date()
    provider.update(enabled: false, orientation: .portrait)
    #expect(source.locationStops == 1 && source.headingStops == 1)
    #expect(provider.heading == nil)
    provider.receive(trueHeading: 40, magneticHeading: 45, accuracy: 5, timestamp: Date())
    #expect(provider.heading == nil)
    provider.update(enabled: true, orientation: .portrait)
    provider.receive(
      trueHeading: 40, magneticHeading: 45, accuracy: 5, timestamp: previousTimestamp)
    #expect(provider.heading == nil)
    provider.receive(trueHeading: 40, magneticHeading: 45, accuracy: 5, timestamp: Date())
    #expect(try #require(provider.heading).degrees == 40)

    source.authorizationStatus = .denied
    provider.locationManagerDidChangeAuthorization(manager)
    #expect(source.locationStops == 2 && source.headingStops == 2)
    #expect(provider.heading == nil)
    provider.stop()
    source.authorizationStatus = .authorizedWhenInUse
    provider.locationManagerDidChangeAuthorization(manager)
    #expect(source.headingStarts == 2)  // Teardown cannot restart from a late delegate callback.
  }

  @MainActor @Test func rotationAndInvalidReadingsCannotLeaveAnOldBearingVisible() throws {
    let source = TestHeadingSource()
    let provider = UserHeadingProvider(source: source, isAvailable: { true })
    provider.update(enabled: true, orientation: .portrait)
    let oldTimestamp = Date()
    provider.receive(trueHeading: 0, magneticHeading: 10, accuracy: 5, timestamp: oldTimestamp)
    #expect(provider.heading != nil)
    provider.update(enabled: true, orientation: .landscapeLeft)
    #expect(source.headingOrientation == .landscapeRight)
    #expect(source.headingStops == 1 && source.headingStarts == 2)
    #expect(provider.heading == nil)
    provider.receive(trueHeading: 0, magneticHeading: 10, accuracy: 5, timestamp: oldTimestamp)
    #expect(provider.heading == nil)
    provider.receive(trueHeading: 90, magneticHeading: 100, accuracy: 5, timestamp: Date())
    #expect(try #require(provider.heading).degrees == 90)
    provider.receive(trueHeading: 90, magneticHeading: 100, accuracy: -1, timestamp: Date())
    #expect(provider.heading == nil)
    provider.stop()
  }
}

@MainActor
private final class TestHeadingSource: HeadingSource {
  weak var delegate: (any CLLocationManagerDelegate)?
  var authorizationStatus = CLAuthorizationStatus.authorizedWhenInUse
  var headingOrientation = CLDeviceOrientation.portrait
  var headingFilter: CLLocationDegrees = 1
  var desiredAccuracy: CLLocationAccuracy = 100
  var headingStarts = 0
  var headingStops = 0
  var locationStarts = 0
  var locationStops = 0
  func startUpdatingHeading() { headingStarts += 1 }
  func stopUpdatingHeading() { headingStops += 1 }
  func startUpdatingLocation() { locationStarts += 1 }
  func stopUpdatingLocation() { locationStops += 1 }
}
