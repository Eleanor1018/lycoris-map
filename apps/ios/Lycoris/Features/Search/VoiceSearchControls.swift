import SwiftUI

/// Native controls inside the ordinary search panel; dictation uses its query/results.
struct VoiceSearchControls: View {
  let voice: VoiceSearchController
  let onFinish: () -> Void
  let onRetry: () -> Void
  let onKeyboard: () -> Void
  let onCancel: () -> Void
  @Environment(\.openURL) private var openURL
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    Group {
      if dynamicTypeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            Spacer()
            quickActions
          }
          ScrollView {
            VStack(alignment: .leading, spacing: 12) {
              statusLabel
              primaryActions
            }.frame(maxWidth: .infinity, alignment: .leading)
          }
          .frame(maxHeight: 220)
          .accessibilityIdentifier("voice.controls")
        }
      } else {
        VStack(alignment: .leading, spacing: 8) {
          statusLabel
          HStack(spacing: 12) {
            primaryActions
            Spacer(minLength: 0)
            quickActions
          }
        }
      }
    }
    .padding(12)
    .background(.quaternary, in: .rect(cornerRadius: 16))
  }

  private var statusLabel: some View {
    HStack(alignment: .top) {
      if voice.state == .authorizing || voice.state == .finishing { ProgressView() }
      Label {
        status.fixedSize(horizontal: false, vertical: true)
      } icon: {
        Image(systemName: voice.state == .recording ? "waveform" : "microphone")
      }
      .font(.subheadline)
      .accessibilityIdentifier("voice.status")
    }
  }

  @ViewBuilder private var primaryActions: some View {
    if voice.state == .recording {
      Button("Stop recording", action: onFinish).buttonStyle(.bordered)
    } else if voice.state == .denied {
      Button("Open Settings") { openURL(URL(string: UIApplication.openSettingsURLString)!) }
        .buttonStyle(.bordered)
      Button("Try again", action: onRetry).buttonStyle(.bordered)
    } else if [.idle, .ready, .failed].contains(voice.state) {
      Button("Start recording", action: onRetry).buttonStyle(.bordered)
    }
  }

  private var quickActions: some View {
    HStack(spacing: 8) {
      Button("Use keyboard", systemImage: "keyboard", action: onKeyboard)
        .accessibilityIdentifier("voice.keyboard")
      Button("Cancel", systemImage: "xmark", action: onCancel)
        .accessibilityIdentifier("voice.cancel")
    }
    .labelStyle(.iconOnly)
    .buttonStyle(VoiceIconButtonStyle())
  }

  private var status: Text {
    switch voice.state {
    case .idle: Text("Ready to listen")
    case .authorizing: Text("Waiting for permission…")
    case .recording: Text("Listening…")
    case .finishing: Text("Recognizing…", tableName: "Voice")
    case .ready: Text("Ready to search")
    case .unsupported: Text("On-device speech recognition is unavailable. Please use the keyboard.")
    case .denied:
      Text("Allow microphone and speech recognition access in Settings, or use the keyboard.")
    case .failed: Text("Could not recognize speech. Try again or use the keyboard.")
    }
  }
}

private struct VoiceIconButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.system(size: 20)).foregroundStyle(.tint)
      .frame(width: 44, height: 44).contentShape(Rectangle())
      .opacity(configuration.isPressed ? 0.5 : 1)
  }
}
