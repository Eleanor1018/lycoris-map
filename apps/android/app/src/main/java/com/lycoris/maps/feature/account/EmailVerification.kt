package com.lycoris.maps.feature.account

import android.os.SystemClock
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.lycoris.maps.core.data.isValidAccountEmail
import com.lycoris.maps.core.model.Language
import com.lycoris.maps.core.network.ApiFailure
import com.lycoris.maps.core.network.EmailCodeReceipt
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Only deadlines survive recreation. Passwords, codes and in-flight requests are never saved. */
internal class EmailCodeState(private val clock: () -> Long = SystemClock::elapsedRealtime) {
    var sending by mutableStateOf(false)
        private set
    var retryUntil by mutableLongStateOf(0L)
        private set
    var lockedUntil by mutableLongStateOf(0L)
        private set
    var now by mutableLongStateOf(clock())
        private set
    var receipt by mutableStateOf<EmailCodeReceipt?>(null)
        private set
    var failure by mutableStateOf<ApiFailure?>(null)
        private set

    val remaining: Long get() = ((maxOf(retryUntil, lockedUntil) - now + 999) / 1000).coerceAtLeast(0)
    val locked: Boolean get() = lockedUntil > now

    fun tick() { now = clock() }

    fun applyCooldown(error: ApiFailure) {
        if (error !is ApiFailure.Http || error.status != 429) return
        tick()
        val seconds = error.retryAfterSeconds?.takeIf { it > 0 }
            ?: if (error.serviceCode == 42931) 3600 else 60
        val deadline = now + seconds.coerceAtMost(86400) * 1000L
        retryUntil = maxOf(retryUntil, deadline)
        if (error.serviceCode == 42931) lockedUntil = maxOf(lockedUntil, deadline)
    }

    suspend fun send(request: suspend () -> EmailCodeReceipt, onSent: () -> Unit) {
        tick()
        if (sending || remaining > 0) return
        sending = true
        failure = null
        receipt = null
        try {
            val response = request()
            tick()
            retryUntil = now + response.retryAfterSeconds.coerceIn(1, 86400) * 1000L
            receipt = response
            onSent()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiFailure) {
            failure = error
            applyCooldown(error)
        } finally {
            sending = false
        }
    }

    companion object {
        val Saver = listSaver<EmailCodeState, Long>(
            save = { listOf(it.retryUntil, it.lockedUntil) },
            restore = { values -> EmailCodeState().apply {
                retryUntil = values[0]
                lockedUntil = values[1]
            } },
        )
    }
}

@Composable
internal fun rememberEmailCodeState(email: String, failure: ApiFailure?): EmailCodeState {
    val recipient = email.trim().lowercase(Locale.ROOT)
    val state = rememberSaveable(recipient, saver = EmailCodeState.Saver) { EmailCodeState() }
    LaunchedEffect(state, failure) { failure?.let(state::applyCooldown) }
    LaunchedEffect(state, state.retryUntil, state.lockedUntil) {
        state.tick()
        while (state.remaining > 0) {
            delay(1000)
            state.tick()
        }
    }
    return state
}

@Composable
internal fun EmailCodeField(
    email: String,
    code: String,
    onCode: (String) -> Unit,
    language: Language,
    busy: Boolean,
    state: EmailCodeState,
    send: suspend (String) -> EmailCodeReceipt,
    onDone: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    AccountField(code, { onCode(it.filter { c -> c in '0'..'9' }.take(6)) },
        language.text("验证码", "Verification Code"),
        enabled = !busy && !state.sending && !state.locked,
        keyboardType = KeyboardType.Number, imeAction = ImeAction.Done, onDone = onDone)
    OutlinedButton(
        onClick = { scope.launch { state.send({ send(email) }) { onCode("") } } },
        enabled = !busy && !state.sending && state.remaining == 0L && isValidAccountEmail(email),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        shape = RoundedCornerShape(24.dp),
    ) {
        Text(when {
            state.sending -> language.text("正在发送…", "Sending…")
            state.remaining > 0 -> language.text("${state.remaining} 秒后重发", "Resend in ${state.remaining}s")
            else -> language.text("发送验证码", "Send code")
        })
    }
    val notice = state.failure?.let { accountFailureMessage(it, language, AccountPage.RESET) }
        ?: state.receipt?.let { receipt ->
            val seconds = receipt.expiresInSeconds
            if (seconds % 60 == 0) language.text(
                "验证码已发送，${seconds / 60} 分钟内有效。",
                "A code has been sent. It expires in ${seconds / 60} minutes.",
            ) else language.text("验证码已发送，${seconds} 秒内有效。", "A code has been sent. It expires in ${seconds} seconds.")
        }
    notice?.let {
        Text(it, style = MaterialTheme.typography.bodySmall,
            color = if (state.failure != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
}
