import Testing
import UIKit

@testable import Lycoris

@MainActor struct MapKeyboardTests {
  @Test func onlyDockedKeyboardConsumesWindowHeight() {
    let window = CGRect(x: 0, y: 0, width: 834, height: 1210)
    #expect(MapKeyboardObserver.ObserverView.bottomOverlap(
      keyboard: CGRect(x: 0, y: 850, width: 834, height: 360), window: window) == 360)
    #expect(MapKeyboardObserver.ObserverView.bottomOverlap(
      keyboard: CGRect(x: 400, y: 900, width: 320, height: 310), window: window) == 0)
    #expect(MapKeyboardObserver.ObserverView.bottomOverlap(
      keyboard: CGRect(x: 0, y: 1210, width: 834, height: 360), window: window) == 0)
  }

  @Test func keyboardOutsideAResizedWindowDoesNotObscureContent() {
    let window = CGRect(x: 0, y: 0, width: 800, height: 600)
    #expect(MapKeyboardObserver.ObserverView.bottomOverlap(
      keyboard: CGRect(x: -100, y: 750, width: 1200, height: 400), window: window) == 0)
    #expect(MapKeyboardObserver.ObserverView.bottomOverlap(
      keyboard: CGRect(x: -100, y: 480, width: 1200, height: 400), window: window) == 120)
  }
}
