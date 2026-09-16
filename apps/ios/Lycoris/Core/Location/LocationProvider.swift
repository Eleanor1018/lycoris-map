import CoreLocation
import Observation

@MainActor @Observable
final class LocationProvider: NSObject, @MainActor CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private var completion: ((Result<GeoPoint, Failure>) -> Void)?
  private var timeout: Task<Void, Never>?
  private(set) var isAuthorized = false
  private(set) var isRequesting = false
  private(set) var hasRequestedLocation = false

  enum Failure: Error { case denied, unavailable }

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    isAuthorized = authorized
  }

  private var authorized: Bool {
    manager.authorizationStatus == .authorizedWhenInUse
      || manager.authorizationStatus == .authorizedAlways
  }

  /// Only called from a location button or an explicit Nearby entry.
  func request(_ completion: @escaping (Result<GeoPoint, Failure>) -> Void) {
    timeout?.cancel()
    hasRequestedLocation = true
    self.completion = completion
    isRequesting = true
    switch manager.authorizationStatus {
    case .notDetermined: manager.requestWhenInUseAuthorization()
    case .authorizedAlways, .authorizedWhenInUse: requestFix()
    case .denied, .restricted: finish(.failure(.denied))
    @unknown default: finish(.failure(.unavailable))
    }
  }

  private func requestFix() {
    manager.requestLocation()
    timeout?.cancel()
    timeout = Task { [weak self] in
      do { try await Task.sleep(for: .seconds(15)) } catch { return }
      self?.finish(.failure(.unavailable))
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    isAuthorized = authorized
    guard isRequesting else { return }
    if authorized {
      requestFix()
    } else if manager.authorizationStatus != .notDetermined {
      finish(.failure(.denied))
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let fix = locations.last, fix.horizontalAccuracy >= 0,
      abs(fix.timestamp.timeIntervalSinceNow) < 60,
      let point = GeoPoint(latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude)
    else {
      finish(.failure(.unavailable))
      return
    }
    finish(.success(point))
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
    finish(.failure(manager.authorizationStatus == .denied ? .denied : .unavailable))
  }

  private func finish(_ result: Result<GeoPoint, Failure>) {
    guard let completion else { return }
    self.completion = nil
    timeout?.cancel()
    timeout = nil
    manager.stopUpdatingLocation()
    isRequesting = false
    completion(result)
  }
}
