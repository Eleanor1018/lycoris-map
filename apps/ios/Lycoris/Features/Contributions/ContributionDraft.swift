import CryptoKit
import Foundation

enum ContributionFailure: Error, Equatable {
  case accountBusy, invalidReceipt, missingPhoto, storage, invalidFields
}

struct ContributionFields: Codable, Equatable {
  var title = ""
  var category = PlaceCategory.toilet
  var description = ""
  var openTimeStart = ""
  var openTimeEnd = ""
  var language = "en"

  var valid: Bool {
    !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && title.unicodeScalars.count <= 120
      && ((openTimeStart.isEmpty && openTimeEnd.isEmpty)
        || (Self.validTime(openTimeStart) && Self.validTime(openTimeEnd)))
  }

  static func validTime(_ value: String) -> Bool {
    value.range(of: #"^(?:[01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil
  }

  init(language: String) { self.language = language }
  init(marker: Marker) {
    title = marker.title
    category = marker.category
    description = marker.description ?? ""
    openTimeStart = marker.openTimeStart ?? ""
    openTimeEnd = marker.openTimeEnd ?? ""
    language = marker.contentLanguage
  }
}

struct ContributionDraft: Codable, Equatable, Identifiable {
  enum Phase: String, Codable { case draft, creating, editing, uncertainEdit, uploading, complete }
  let id: UUID
  let owner: String
  let origin: String
  var point: GeoPoint
  let original: Marker?
  var fields: ContributionFields
  var phase = Phase.draft
  var requestBody: Data?
  var markerID: Int64?
  var photoID: UUID?
  var photoHash: String?
  var photoSize: Int?
  var upload: UploadReceipt?
  var photoRejected = false

  init(owner: String, origin: String, point: GeoPoint, language: String, marker: Marker? = nil) {
    id = UUID()
    self.owner = owner
    self.origin = origin
    self.point = point
    original = marker
    fields = marker.map(ContributionFields.init) ?? ContributionFields(language: language)
    markerID = marker?.id
  }

  var editable: Bool { phase == .draft }
  var hasChanges: Bool { original.map { fields != ContributionFields(marker: $0) } ?? true }
  var canSubmit: Bool { fields.valid && (hasChanges || photoID != nil) }

  var validCheckpoint: Bool {
    guard !owner.isEmpty, !origin.isEmpty,
      GeoPoint(latitude: point.latitude, longitude: point.longitude) != nil,
      markerID == nil || markerID! > 0
    else { return false }
    if [.uploading, .complete].contains(phase), markerID == nil { return false }
    if [.creating, .editing, .uncertainEdit].contains(phase), requestBody == nil { return false }
    if [.editing, .uncertainEdit].contains(phase), original == nil { return false }
    if phase == .creating && original != nil { return false }
    if let original, original.point != point || original.id != markerID { return false }
    if let photoSize, let photoHash, photoID != nil {
      guard (1...(5 * 1024 * 1024)).contains(photoSize),
        photoHash.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
      else { return false }
    } else if photoID != nil || photoSize != nil || photoHash != nil || phase == .uploading {
      return false
    }
    if let upload { return (try? upload.validate(for: self)) != nil }
    return true
  }

  func encodedRequest() throws -> Data {
    var json: [String: Any] = [
      "title": fields.title, "description": fields.description,
      "category": fields.category.rawValue, "language": fields.language,
      "openTimeStart": fields.openTimeStart, "openTimeEnd": fields.openTimeEnd,
    ]
    if original == nil {
      json["lat"] = point.latitude
      json["lng"] = point.longitude
      json["clientRequestId"] = id.uuidString
    }
    return try JSONSerialization.data(withJSONObject: json, options: .sortedKeys)
  }
}

struct UploadReceipt: Codable, Equatable {
  let uploadId: String
  let markerId: Int64
  let totalBytes: Int
  let receivedBytes: Int
  let chunkSize: Int
  let status: String
  var complete: Bool { status == "COMPLETED" }

  func validate(for draft: ContributionDraft) throws {
    guard UUID(uuidString: uploadId) != nil, markerId == draft.markerID,
      totalBytes == draft.photoSize, chunkSize == 262_144,
      receivedBytes >= 0, receivedBytes <= totalBytes,
      receivedBytes == totalBytes || receivedBytes % chunkSize == 0,
      ["UPLOADING", "COMPLETED"].contains(status),
      !complete || receivedBytes == totalBytes,
      draft.upload == nil || draft.upload?.uploadId == uploadId,
      receivedBytes >= (draft.upload?.receivedBytes ?? 0)
    else { throw ContributionFailure.invalidReceipt }
  }
}

/// One private, atomic journal. The final encoded image is written first, never
/// regenerated on retry. Neither file participates in device/iCloud backups.
struct ContributionJournal {
  let directory: URL
  init(directory: URL? = nil) {
    self.directory =
      directory
      ?? URL.applicationSupportDirectory.appendingPathComponent(
        "Contribution", isDirectory: true)
  }
  private var record: URL { directory.appendingPathComponent("draft.json") }
  func photoURL(_ id: UUID) -> URL { directory.appendingPathComponent("\(id.uuidString).jpg") }

  func load() throws -> ContributionDraft? {
    guard FileManager.default.fileExists(atPath: record.path) else { return nil }
    let value = try JSONDecoder().decode(ContributionDraft.self, from: Data(contentsOf: record))
    guard value.validCheckpoint else { throw ContributionFailure.storage }
    return value
  }
  func save(_ draft: ContributionDraft) throws {
    try prepare()
    try JSONEncoder().encode(draft).write(
      to: record, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }
  func savePhoto(_ data: Data, id: UUID) throws -> (hash: String, size: Int) {
    guard !data.isEmpty, data.count <= 5 * 1024 * 1024 else { throw AccountFailure(status: 413) }
    try prepare()
    try data.write(
      to: photoURL(id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    // Hash the durable bytes, exactly as subsequent requests will read them.
    let saved = try Data(contentsOf: photoURL(id))
    return (Self.hash(saved), saved.count)
  }
  func photo(_ draft: ContributionDraft) throws -> Data {
    guard let id = draft.photoID, let data = try? Data(contentsOf: photoURL(id)),
      data.count == draft.photoSize, Self.hash(data) == draft.photoHash
    else { throw ContributionFailure.missingPhoto }
    return data
  }
  func removePhoto(_ id: UUID?) {
    if let id { try? FileManager.default.removeItem(at: photoURL(id)) }
  }
  func clear() throws {
    if FileManager.default.fileExists(atPath: directory.path) {
      try FileManager.default.removeItem(at: directory)
    }
  }
  private func prepare() throws {
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true,
      attributes: [
        .posixPermissions: 0o700,
        .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
      ])
    var location = directory
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try location.setResourceValues(values)
  }
  static func hash(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}
