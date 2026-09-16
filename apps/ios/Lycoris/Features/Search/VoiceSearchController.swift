@preconcurrency import AVFoundation
import Observation
@preconcurrency import Speech

@MainActor @Observable
final class VoiceSearchController {
  enum State: Equatable { case idle, authorizing, recording, ready, unsupported, denied, failed }
  private(set) var state: State = .idle
  private(set) var transcript = ""
  private var engine: AVAudioEngine?
  private var hasTap = false
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var recognizer: SFSpeechRecognizer?
  private var recognition: SFSpeechRecognitionTask?
  private var timeout: Task<Void, Never>?
  private var generation = UUID()

  func start(language: AppLanguage) async {
    stop()
    transcript = ""
    let token = generation
    guard let recognizer = SFSpeechRecognizer(locale: language.locale),
      recognizer.supportsOnDeviceRecognition
    else {
      state = .unsupported
      return
    }
    self.recognizer = recognizer
    state = .authorizing
    let authorization = await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { @Sendable status in
        continuation.resume(returning: status)
      }
    }
    guard token == generation, !Task.isCancelled else { return }
    guard authorization == .authorized else {
      state = .denied
      return
    }
    let microphone = await AVAudioApplication.requestRecordPermission()
    guard token == generation, !Task.isCancelled else { return }
    guard microphone else {
      state = .denied
      return
    }
    guard recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
      state = .unsupported
      return
    }
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.record, mode: .measurement, options: .duckOthers)
      try session.setActive(true, options: .notifyOthersOnDeactivation)
      let engine = AVAudioEngine()
      self.engine = engine
      let request = SFSpeechAudioBufferRecognitionRequest()
      request.requiresOnDeviceRecognition = true
      request.shouldReportPartialResults = true
      request.taskHint = .search
      self.request = request
      let input = engine.inputNode
      let format = input.outputFormat(forBus: 0)
      guard format.sampleRate > 0, format.channelCount > 0 else {
        stop()
        state = .failed
        return
      }
      input.installTap(
        onBus: 0, bufferSize: 1024, format: format, block: Self.audioTap(for: request))
      hasTap = true
      recognition = recognizer.recognitionTask(with: request) {
        @Sendable [weak self] result, error in
        let text = result?.bestTranscription.formattedString
        let finished = result?.isFinal == true
        let failed = error != nil
        Task { @MainActor in
          guard let self, token == self.generation else { return }
          if let text { self.transcript = text }
          if finished || failed {
            self.stop()
            if self.transcript.isEmpty && failed { self.state = .failed }
          }
        }
      }
      engine.prepare()
      try engine.start()
      state = .recording
      timeout = Task { [weak self] in
        try? await Task.sleep(for: .seconds(55))
        guard !Task.isCancelled, let self, self.generation == token else { return }
        self.stop()
      }
    } catch {
      stop()
      state = .failed
    }
  }

  // AVAudioEngine invokes its tap on an audio thread. Build the callback outside
  // MainActor and consume each buffer synchronously on that thread.
  nonisolated private static func audioTap(
    for request: SFSpeechAudioBufferRecognitionRequest
  ) -> AVAudioNodeTapBlock {
    { buffer, _ in request.append(buffer) }
  }

  /// Invalidates permission/recognition callbacks as well as stopping the microphone.
  func stop() {
    generation = UUID()
    timeout?.cancel()
    timeout = nil
    if let engine {
      engine.stop()
      if hasTap { engine.inputNode.removeTap(onBus: 0) }
    }
    hasTap = false
    engine = nil
    request?.endAudio()
    recognition?.cancel()
    recognition = nil
    recognizer = nil
    request = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    if state == .recording || state == .authorizing {
      state = transcript.isEmpty ? .idle : .ready
    }
  }
}
