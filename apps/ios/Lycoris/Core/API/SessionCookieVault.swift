import Foundation
import Security
import Synchronization

/// URLSession's cookie disk writes may lag an immediate process termination.
/// Snapshot only this service's persistent cookies synchronously in the device-only Keychain.
struct SessionCookieVault: Sendable {
  let origin: URL
  private static let restoredOrigins = Mutex<Set<String>>([])
  // Use a canonical root path when asking Foundation for origin cookies.
  var cookieURL: URL {
    var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
    if components.path.isEmpty { components.path = "/" }
    return components.url!
  }
  private var key: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "com.lycoris.maps.session-cookies",
      kSecAttrAccount as String: origin.absoluteString,
    ]
  }

  func restore(into storage: HTTPCookieStorage) {
    Self.restoredOrigins.withLock { origins in
      guard origins.insert(origin.absoluteString).inserted else { return }
      restoreSnapshot(into: storage)
    }
  }

  private func restoreSnapshot(into storage: HTTPCookieStorage) {
    var query = key
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    let readStatus = SecItemCopyMatching(query as CFDictionary, &value)
    guard readStatus == errSecSuccess,
      let data = value as? Data, let cookies = try? Self.decode(data)
    else { return }
    // The snapshot also records an empty jar after logout, overriding a delayed old disk write.
    for cookie in storage.cookies(for: cookieURL) ?? [] { storage.deleteCookie(cookie) }
    for cookie in cookies {
      storage.setCookie(cookie)
    }
  }

  func save(from storage: HTTPCookieStorage) throws {
    let data = try Self.encode(storage.cookies(for: cookieURL) ?? [])
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemUpdate(key as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      var item = key
      item.merge(attributes) { _, new in new }
      let added = SecItemAdd(item as CFDictionary, nil)
      guard added == errSecSuccess else { throw SessionStorageFailure(status: added) }
    } else if status != errSecSuccess {
      throw SessionStorageFailure(status: status)
    }
  }

  static func encode(_ cookies: [HTTPCookie], now: Date = Date()) throws -> Data {
    try JSONEncoder().encode(
      cookies.compactMap { cookie -> StoredCookie? in
        guard let expires = cookie.expiresDate, expires > now, !cookie.isSessionOnly else {
          return nil
        }
        return StoredCookie(
          name: cookie.name, value: cookie.value, domain: cookie.domain,
          path: cookie.path, secure: cookie.isSecure, httpOnly: cookie.isHTTPOnly,
          expires: expires, ports: cookie.portList?.map(\.intValue))
      })
  }

  static func decode(_ data: Data, now: Date = Date()) throws -> [HTTPCookie] {
    try JSONDecoder().decode([StoredCookie].self, from: data).compactMap { record in
      guard record.expires > now else { return nil }
      var properties: [HTTPCookiePropertyKey: Any] = [
        .name: record.name, .value: record.value, .domain: record.domain,
        .path: record.path, .expires: record.expires,
      ]
      if record.secure { properties[.secure] = "TRUE" }
      if record.httpOnly { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
      // Darwin reports [] for unrestricted cookies; Port="" incorrectly restricts them to port 0.
      if let ports = record.ports, !ports.isEmpty {
        properties[.port] = ports.map(String.init).joined(separator: ",")
      }
      return HTTPCookie(properties: properties)
    }
  }
}

struct SessionStorageFailure: Error, Equatable { let status: OSStatus }

private struct StoredCookie: Codable {
  let name: String
  let value: String
  let domain: String
  let path: String
  let secure: Bool
  let httpOnly: Bool
  let expires: Date
  let ports: [Int]?
}
