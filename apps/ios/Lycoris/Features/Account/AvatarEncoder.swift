import ImageIO
import UniformTypeIdentifiers

enum AvatarEncoder {
  /// Decode a bounded, orientation-correct thumbnail; HEIC never reaches the server.
  static func jpeg(from data: Data, maximumDimension: Int = 1024) throws -> Data {
    guard data.count <= 50 * 1024 * 1024,
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateThumbnailAtIndex(
        source, 0,
        [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: maximumDimension,
        ] as CFDictionary)
    else { throw AccountFailure(status: 400) }
    let output = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        output, UTType.jpeg.identifier as CFString, 1, nil)
    else { throw AccountFailure(status: 400) }
    CGImageDestinationAddImage(
      destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
    guard CGImageDestinationFinalize(destination), output.length <= 5 * 1024 * 1024 else {
      throw AccountFailure(status: 413)
    }
    return output as Data
  }
}
