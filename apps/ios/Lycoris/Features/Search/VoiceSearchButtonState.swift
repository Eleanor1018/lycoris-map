import Foundation

/// The single source of truth for the map search microphone button's semantics.
///
/// It is derived from the live voice controller state plus whether the voice
/// panel is open, so the button's label, enabled state and action always agree.
/// Nothing here mutates production state; the view dispatches the matching
/// business action through `MapScreen`.
enum VoiceSearchButtonState: Equatable {
  /// Voice panel closed: tapping starts voice search.
  case start
  /// Recording: tapping stops recording (calls `finish`).
  case stop
  /// Buffered recognition is finishing; the enabled-for-tap action is a no-op.
  case recognizing
  /// Voice panel open but not recording (idle/ready/failed/denied/unsupported/
  /// authorizing): tapping closes the panel and cancels voice search.
  case close

  init(isVoicePanelOpen: Bool, state: VoiceSearchController.State) {
    guard isVoicePanelOpen else {
      self = .start
      return
    }
    switch state {
    case .recording: self = .stop
    case .finishing: self = .recognizing
    case .idle, .authorizing, .ready, .unsupported, .denied, .failed: self = .close
    }
  }

  var isEnabled: Bool { self != .recognizing }

  /// The localized accessibility label, using the app's selected language.
  func label(language: AppLanguage) -> String {
    switch self {
    case .start:
      return String(appLocalized: "Voice search", language: language, table: "Accessibility")
    case .stop:
      return String(appLocalized: "Stop recording", language: language, table: "Accessibility")
    case .recognizing:
      return String(appLocalized: "Recognizing…", language: language, table: "Accessibility")
    case .close:
      return String(appLocalized: "Close voice search", language: language, table: "Accessibility")
    }
  }

  var usesActiveAppearance: Bool {
    switch self {
    case .stop, .recognizing, .close: return true
    case .start: return false
    }
  }

  var symbolName: String {
    switch self {
    case .start: return "microphone"
    case .stop, .recognizing: return "waveform"
    case .close: return "xmark"
    }
  }
}
