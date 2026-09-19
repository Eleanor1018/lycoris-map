import CoreLocation
import UIKit

/// A compass bearing, never the location's course (which requires movement).
struct UserHeading: Equatable {
  let degrees: Double
  let accuracy: Double

  init?(trueHeading: Double, magneticHeading: Double, accuracy: Double) {
    guard accuracy.isFinite, (0...180).contains(accuracy) else { return nil }
    let bearing = (0..<360).contains(trueHeading) ? trueHeading : magneticHeading
    guard bearing.isFinite, (0..<360).contains(bearing) else { return nil }
    degrees = bearing
    self.accuracy = accuracy
  }

  func rotation(relativeTo mapHeading: Double) -> Double {
    let angle = (degrees - mapHeading) * .pi / 180
    return atan2(sin(angle), cos(angle))
  }

  static func orientation(for interface: UIInterfaceOrientation) -> CLDeviceOrientation {
    switch interface {
    case .portraitUpsideDown: .portraitUpsideDown
    // UIKit's interface rotation and the physical device rotation use opposite names.
    case .landscapeLeft: .landscapeRight
    case .landscapeRight: .landscapeLeft
    default: .portrait
    }
  }
}

@MainActor
protocol HeadingSource: AnyObject {
  var delegate: (any CLLocationManagerDelegate)? { get set }
  var authorizationStatus: CLAuthorizationStatus { get }
  var headingOrientation: CLDeviceOrientation { get set }
  var headingFilter: CLLocationDegrees { get set }
  var desiredAccuracy: CLLocationAccuracy { get set }
  func startUpdatingHeading()
  func stopUpdatingHeading()
  func startUpdatingLocation()
  func stopUpdatingLocation()
}

extension CLLocationManager: HeadingSource {}

/// Owned by the map coordinator, so sensor events update UIKit without rebuilding SwiftUI.
@MainActor
final class UserHeadingProvider: NSObject, @MainActor CLLocationManagerDelegate {
  private let source: any HeadingSource
  private let isAvailable: () -> Bool
  private var enabled = false
  private var startedAt: Date?
  private(set) var heading: UserHeading?
  var onChange: (() -> Void)?

  init(
    source: any HeadingSource = CLLocationManager(),
    isAvailable: @escaping () -> Bool = CLLocationManager.headingAvailable
  ) {
    self.source = source
    self.isAvailable = isAvailable
    super.init()
    source.delegate = self
    source.headingFilter = 1
    source.desiredAccuracy = kCLLocationAccuracyHundredMeters
  }

  func update(enabled: Bool, orientation: UIInterfaceOrientation) {
    self.enabled = enabled
    let orientation = UserHeading.orientation(for: orientation)
    if source.headingOrientation != orientation {
      stopUpdates()
      source.headingOrientation = orientation
    }
    reconcile()
  }

  private func reconcile() {
    let authorized =
      source.authorizationStatus == .authorizedWhenInUse
      || source.authorizationStatus == .authorizedAlways
    guard enabled, authorized, isAvailable() else {
      stopUpdates()
      return
    }
    guard startedAt == nil else { return }
    startedAt = Date()
    // Core Location needs location updates to provide a true-north bearing.
    // This stream never changes the camera or the captured Nearby search origin.
    source.startUpdatingLocation()
    source.startUpdatingHeading()
  }

  func stop() {
    enabled = false
    stopUpdates()
  }

  private func stopUpdates() {
    if startedAt != nil {
      source.stopUpdatingHeading()
      source.stopUpdatingLocation()
    }
    startedAt = nil
    clearHeading()
  }

  private func clearHeading() {
    guard heading != nil else { return }
    heading = nil
    onChange?()
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { reconcile() }

  func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
    receive(
      trueHeading: newHeading.trueHeading, magneticHeading: newHeading.magneticHeading,
      accuracy: newHeading.headingAccuracy, timestamp: newHeading.timestamp)
  }

  func receive(trueHeading: Double, magneticHeading: Double, accuracy: Double, timestamp: Date) {
    guard let startedAt, timestamp >= startedAt, abs(timestamp.timeIntervalSinceNow) < 5 else {
      return
    }
    heading = UserHeading(
      trueHeading: trueHeading, magneticHeading: magneticHeading, accuracy: accuracy)
    onChange?()
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
    clearHeading()
    reconcile()
  }

  func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool {
    false
  }
}
