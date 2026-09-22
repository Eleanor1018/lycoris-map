package com.lycoris.maps.core.device

import android.Manifest
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.annotation.MainThread
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale

/**
 * Explicitly initiated, on-device speech search. No cloud recognizer or implicit network fallback.
 * Set foreground from lifecycle ON_RESUME/ON_PAUSE; request RECORD_AUDIO in the Activity only after
 * the microphone tap, then call start again on grant. Call cancel on back/cancel/search-surface exit,
 * and destroy on owner disposal. Observe RESULT once, submit transcript, then call consumeResult.
 * API <31 or devices without an on-device recognizer report UNAVAILABLE; keep text search usable.
 */
class VoiceController(context: Context) {
    private val context = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private val machine = VoiceSessionMachine()
    val state: StateFlow<VoiceState> = machine.state
    private var recognizer: SpeechRecognizer? = null
    private var foreground = false
    private var destroyed = false
    private var deadline: Runnable? = null
    private var token: Long? = null
    private val permissionObserver = PermissionObserver(this.context, setOf(AppOpsManager.OPSTR_RECORD_AUDIO)) {
        refreshPermission()
    }

    @MainThread
    fun isOnDeviceAvailable(): Boolean {
        checkMainThread()
        return Build.VERSION.SDK_INT >= 31 &&
            runCatching { SpeechRecognizer.isOnDeviceRecognitionAvailable(context) }.getOrDefault(false)
    }

    @MainThread
    fun hasRecordingPermission(): Boolean =
        canAccessPermission(context, Manifest.permission.RECORD_AUDIO, AppOpsManager.OPSTR_RECORD_AUDIO)

    @MainThread
    fun setForeground(isForeground: Boolean) {
        checkMainThread()
        foreground = isForeground
        if (!isForeground) cancel()
        else refreshPermission()
    }

    @MainThread
    fun refreshPermission() {
        checkMainThread()
        val currentToken = token ?: return
        if (!hasRecordingPermission()) finishFailure(currentToken, VoiceError.PERMISSION)
    }

    @MainThread
    fun start(languageTag: String) {
        checkMainThread()
        if (destroyed || !foreground) return
        cancel()
        val session = machine.begin(hasRecordingPermission(), isOnDeviceAvailable()) ?: return
        token = session
        // This API guard is also visible to lint; availability alone cannot refine API level.
        if (Build.VERSION.SDK_INT < 31) { finishFailure(session, VoiceError.SERVICE); return }
        val language = Locale.forLanguageTag(languageTag).toLanguageTag()
        if (language == "und") { finishFailure(session, VoiceError.LANGUAGE_UNAVAILABLE); return }
        try {
            val created = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            recognizer = created
            created.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    if (!canReceive(session)) return
                    machine.listening(session)
                }
                override fun onBeginningOfSpeech() {
                    if (canReceive(session)) machine.listening(session)
                }
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() {
                    if (canReceive(session)) machine.processing(session)
                }
                override fun onError(error: Int) {
                    if (canReceive(session)) finishFailure(session, error.asVoiceError())
                }
                override fun onResults(results: Bundle?) {
                    if (!canReceive(session)) return
                    machine.result(session, results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION))
                    release()
                }
                // Interim hypotheses must never submit searches or outlive a cancelled session.
                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
            permissionObserver.start()
            deadline = Runnable {
                if (machine.isCurrent(session)) finishFailure(session, VoiceError.TIMED_OUT)
            }.also { handler.postDelayed(it, 45_000L) }
            created.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            })
        } catch (_: SecurityException) {
            finishFailure(session, VoiceError.PERMISSION)
        } catch (_: RuntimeException) {
            // An OEM service can disappear between availability and creation/start.
            finishFailure(session, VoiceError.SERVICE)
        }
    }

    @MainThread
    fun cancel() {
        checkMainThread()
        machine.cancel() // Invalidate callbacks before cancel()/destroy() can synchronously invoke them.
        release()
    }

    @MainThread
    fun consumeResult() {
        checkMainThread()
        if (!state.value.isActive) machine.cancel()
    }

    @MainThread
    fun destroy() {
        checkMainThread()
        if (destroyed) return
        destroyed = true
        foreground = false
        machine.destroy()
        release()
    }

    private fun canReceive(session: Long): Boolean {
        if (!foreground || !machine.isCurrent(session)) return false
        if (!hasRecordingPermission()) { finishFailure(session, VoiceError.PERMISSION); return false }
        return true
    }

    private fun finishFailure(session: Long, error: VoiceError) {
        if (!machine.isCurrent(session)) return
        machine.fail(session, error)
        release()
    }

    private fun release() {
        token = null
        deadline?.let(handler::removeCallbacks)
        deadline = null
        permissionObserver.stop()
        val previous = recognizer
        recognizer = null
        runCatching { previous?.cancel() }
        runCatching { previous?.destroy() }
    }
}

private fun Int.asVoiceError(): VoiceError = when (this) {
    SpeechRecognizer.ERROR_NO_MATCH -> VoiceError.NO_MATCH
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> VoiceError.NO_SPEECH
    SpeechRecognizer.ERROR_AUDIO -> VoiceError.AUDIO
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> VoiceError.PERMISSION
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> VoiceError.BUSY
    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> VoiceError.LANGUAGE_UNAVAILABLE
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> VoiceError.TIMED_OUT
    else -> VoiceError.SERVICE
}
