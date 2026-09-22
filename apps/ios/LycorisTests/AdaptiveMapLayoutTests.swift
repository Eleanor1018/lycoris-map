import Foundation
import Testing

@testable import Lycoris

struct AdaptiveMapLayoutTests {
  @Test(arguments: [CGSize(width: 402, height: 874), CGSize(width: 600, height: 900),
                    CGSize(width: 900, height: 400)])
  func narrowOrShortWindowsKeepThePhonePresentation(_ size: CGSize) {
    #expect(!AdaptiveMapLayout(size: size).usesSidebar)
  }

  @Test(arguments: [CGSize(width: 834, height: 1210), CGSize(width: 1210, height: 834),
                    CGSize(width: 1032, height: 1376), CGSize(width: 1376, height: 1032),
                    CGSize(width: 760, height: 440)])
  func columnsLeaveUsableMapSpace(_ size: CGSize) {
    let layout = AdaptiveMapLayout(size: size)
    #expect(layout.usesSidebar)
    // Room for the two 48pt tools and a map interaction area beside the content.
    #expect(size.width - layout.leadingOcclusion(contentVisible: true) >= 300)
    #expect(layout.contentWidth >= 340)
    #expect(layout.contentWidth <= 380)
    #expect(layout.leadingOcclusion(contentVisible: false) < layout.leadingOcclusion(contentVisible: true))
  }

  @Test func navigationLabelsDependOnAvailableWidthNotOrientation() {
    #expect(!AdaptiveMapLayout(size: CGSize(width: 1032, height: 1376)).showsNavigationLabels)
    #expect(AdaptiveMapLayout(size: CGSize(width: 1376, height: 1032)).showsNavigationLabels)
  }
}
