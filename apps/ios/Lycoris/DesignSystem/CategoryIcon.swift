import SwiftUI

struct CategoryIcon: View {
  let image: String
  let tint: String

  var body: some View {
    Image(image).resizable().scaledToFit().frame(width: 24, height: 24)
      .frame(width: 30, height: 30)
      .background {
        if image == "Toilet" {
          Circle().fill(
            LinearGradient(
              colors: [Color("ToiletTop"), Color("ToiletBottom")],
              startPoint: .top, endPoint: .bottom))
        } else {
          Circle().fill(Color(tint))
        }
      }
      .accessibilityHidden(true)
  }
}
