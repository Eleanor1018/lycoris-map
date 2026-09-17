import MapKit

/// Keep MapKit's blue dot and accuracy circle; only the compass beam is ours.
/// MapKit exposes its own heading display only with camera-following behavior.
final class DirectionalUserLocationView: MKUserLocationView {
  private let beam = CAGradientLayer()
  private let beamMask = CAShapeLayer()
  private var aperture: Double?

  override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
    super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
    beam.bounds = CGRect(x: 0, y: 0, width: 108, height: 108)
    beam.type = .radial
    beam.startPoint = CGPoint(x: 0.5, y: 0.5)
    beam.endPoint = CGPoint(x: 1, y: 1)
    beam.colors = [
      UIColor.systemBlue.withAlphaComponent(0.55).cgColor,
      UIColor.systemBlue.withAlphaComponent(0.24).cgColor,
      UIColor.systemBlue.withAlphaComponent(0).cgColor,
    ]
    beam.locations = [0, 0.55, 1]
    beam.mask = beamMask
    beamMask.frame = beam.bounds
    beam.isHidden = true
    beam.zPosition = -1
    layer.insertSublayer(beam, at: 0)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    beam.position = CGPoint(x: bounds.midX, y: bounds.midY)
    CATransaction.commit()
  }

  override func prepareForReuse() {
    super.prepareForReuse()
    update(heading: nil, mapHeading: 0, animated: false)
  }

  func update(heading: UserHeading?, mapHeading: Double, animated: Bool) {
    guard let heading else {
      beam.removeAllAnimations()
      beam.isHidden = true
      return
    }
    let wasHidden = beam.isHidden
    let target = heading.rotation(relativeTo: mapHeading)
    let transform = beam.presentation()?.transform ?? beam.transform
    let current = atan2(Double(transform.m12), Double(transform.m11))
    let delta = atan2(sin(target - current), cos(target - current))

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    beam.isHidden = false
    // A less certain compass reading gets a broader beam, rather than a precise arrow.
    let aperture = min(120, max(40, heading.accuracy * 2)) * .pi / 180
    if self.aperture != aperture {
      self.aperture = aperture
      let center = CGPoint(x: 54, y: 54)
      let path = UIBezierPath()
      path.move(to: center)
      path.addArc(
        withCenter: center, radius: 54, startAngle: -.pi / 2 - aperture / 2,
        endAngle: -.pi / 2 + aperture / 2, clockwise: true)
      path.close()
      beamMask.path = path.cgPath
    }
    beam.transform = CATransform3DMakeRotation(target, 0, 0, 1)
    CATransaction.commit()
    beam.removeAnimation(forKey: "bearing")
    if animated && !wasHidden {
      let animation = CABasicAnimation(keyPath: "transform.rotation.z")
      animation.fromValue = current
      animation.toValue = current + delta
      animation.duration = 0.18
      beam.add(animation, forKey: "bearing")
    }
  }
}
