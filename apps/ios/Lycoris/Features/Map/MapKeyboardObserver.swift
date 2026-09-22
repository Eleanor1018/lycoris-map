import SwiftUI

/// Converts screen keyboard notifications into this window's actual occlusion.
/// Floating keyboards don't take away the entire lower half of an iPad window.
struct MapKeyboardObserver: UIViewRepresentable {
  var onChange: (CGFloat) -> Void

  func makeUIView(context: Context) -> ObserverView {
    let view = ObserverView()
    view.onChange = onChange
    return view
  }

  func updateUIView(_ view: ObserverView, context: Context) {
    view.onChange = onChange
  }

  final class ObserverView: UIView {
    var onChange: ((CGFloat) -> Void)?
    private var keyboardFrame: CGRect?
    private var lastHeight: CGFloat = 0

    override init(frame: CGRect) {
      super.init(frame: frame)
      isUserInteractionEnabled = false
      NotificationCenter.default.addObserver(self, selector: #selector(changed(_:)),
        name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
      NotificationCenter.default.addObserver(self, selector: #selector(hidden),
        name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func changed(_ notification: Notification) {
      keyboardFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
      publishHeight()
    }

    @objc private func hidden() {
      keyboardFrame = nil
      publish(0)
    }

    override func layoutSubviews() {
      super.layoutSubviews()
      // A window can resize while the keyboard remains visible.
      if keyboardFrame != nil { publishHeight() }
    }

    private func publishHeight() {
      guard let window, let keyboardFrame else { publish(0); return }
      let frame = window.convert(keyboardFrame, from: window.screen.coordinateSpace)
      let overlap = Self.bottomOverlap(keyboard: frame, window: window.bounds)
      publish(overlap)
    }

    private func publish(_ height: CGFloat) {
      guard height != lastHeight else { return }
      lastHeight = height
      DispatchQueue.main.async { [weak self] in
        guard let self, self.lastHeight == height else { return }
        self.onChange?(height)
      }
    }

    static func bottomOverlap(keyboard: CGRect, window: CGRect) -> CGFloat {
      let intersection = window.intersection(keyboard)
      guard !intersection.isNull, intersection.width >= window.width * 0.8,
        intersection.maxY >= window.maxY - 1
      else { return 0 }
      return intersection.height
    }
  }
}
