import Foundation

struct PlaceLink: Equatable, Sendable {
  let id: Int64

  init?(url: URL) {
    guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
      parts.scheme == "lycoris", parts.host == "maps",
      parts.path.isEmpty || parts.path == "/",
      parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil,
      let items = parts.queryItems, items.allSatisfy({ ["markerId", "lang"].contains($0.name) }),
      Set(items.map(\.name)).count == items.count,
      let raw = items.first(where: { $0.name == "markerId" })?.value,
      raw.range(of: #"^[1-9][0-9]*$"#, options: .regularExpression) != nil,
      let id = Int64(raw), id > 0
    else { return nil }
    if let language = items.first(where: { $0.name == "lang" }),
      !["en", "zh"].contains(language.value ?? "")
    {
      return nil
    }
    self.id = id
  }

  static func url(id: Int64) -> URL? {
    guard id > 0 else { return nil }
    return URL(string: "lycoris://maps?markerId=\(id)")
  }
}
