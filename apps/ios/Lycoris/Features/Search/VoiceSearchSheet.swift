import AVFoundation
import SwiftUI

struct VoiceSearchSheet: View {
  let language: AppLanguage
  let onSearch: (String) -> Void
  let onKeyboard: () -> Void
  @State private var voice = VoiceSearchController()
  @State private var recordingAttempt = 0
  @Environment(\.dismiss) private var dismiss
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.openURL) private var openURL

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Label(status, systemImage: voice.state == .recording ? "waveform" : "microphone")
            .accessibilityIdentifier("voice.status")
          if !voice.transcript.isEmpty { Text(voice.transcript).textSelection(.enabled) }
        } footer: {
          Text("Audio stays on this device. Only the confirmed search text is sent to Lycoris.")
        }
        Section {
          if voice.state == .recording {
            Button("Stop recording") { voice.stop() }
          } else if voice.state == .denied {
            Button("Open Settings") { openURL(URL(string: UIApplication.openSettingsURLString)!) }
            Button("Try again") { recordingAttempt += 1 }
          } else if voice.state != .authorizing && voice.state != .unsupported {
            Button("Start recording") { recordingAttempt += 1 }
          }
          Button("Use keyboard", action: onKeyboard)
            .accessibilityIdentifier("voice.keyboard")
        }
      }
      .navigationTitle("Voice search").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Search") {
            voice.stop()
            onSearch(voice.transcript.trimmingCharacters(in: .whitespacesAndNewlines))
          }.disabled(voice.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      }
      .task(id: recordingAttempt) { await voice.start(language: language) }
      .onDisappear { voice.stop() }
      .onChange(of: scenePhase) { _, phase in
        if phase == .background || (phase == .inactive && voice.state == .recording) {
          voice.stop()
        }
      }
      .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification))
      { _ in voice.stop() }
      .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification))
      { notification in
        let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
        if voice.state == .recording,
          raw == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
            || raw == AVAudioSession.RouteChangeReason.noSuitableRouteForCategory.rawValue
        {
          voice.stop()
        }
      }
    }
  }

  private var status: LocalizedStringKey {
    switch voice.state {
    case .idle: "Ready to listen"
    case .authorizing: "Waiting for permission…"
    case .recording: "Listening…"
    case .ready: "Ready to search"
    case .unsupported: "On-device speech recognition is unavailable. Please use the keyboard."
    case .denied: "Allow microphone and speech recognition access in Settings, or use the keyboard."
    case .failed: "Could not recognize speech. Try again or use the keyboard."
    }
  }
}
