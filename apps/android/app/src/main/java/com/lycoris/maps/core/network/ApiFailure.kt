package com.lycoris.maps.core.network

import java.io.IOException
import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.Response

sealed class ApiFailure(message: String) : IOException(message) {
    class Http(
        val status: Int,
        val serviceCode: Int? = null,
        val requestId: String? = null,
        val serviceMessage: String? = null,
        val retryAfterSeconds: Int? = null,
    ) : ApiFailure("HTTP $status${requestId?.let { " (request $it)" }.orEmpty()}")
    class Network(val timedOut: Boolean) : ApiFailure(if (timedOut) "Request timed out" else "Network unavailable")
    class InvalidResponse : ApiFailure("Invalid service response")
    class InvalidInput(val field: String) : ApiFailure("Invalid $field")
    class SessionRequired : ApiFailure("Sign in required")
    class SessionChanged : ApiFailure("Account changed")
    class SecureStorage : ApiFailure("Could not save the secure session")
}

val LycorisJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}

fun Response<*>.requireSuccess() {
    if (isSuccessful) return
    val requestId = headers()["X-Request-ID"]?.take(128)?.filter { it.isLetterOrDigit() || it in "-_.:" }
    // Never keep arbitrary HTML/private response bodies. Only bounded service diagnostics survive.
    val text = errorBody()?.use { body ->
        val source = body.source()
        source.request(8193)
        source.readUtf8(minOf(source.buffer.size, 8192))
    }.orEmpty()
    val objectValue = runCatching { LycorisJson.parseToJsonElement(text).jsonObject }.getOrNull()
    val code = runCatching { objectValue?.get("code")?.jsonPrimitive?.intOrNull }.getOrNull()
    val message = runCatching { objectValue?.get("message")?.jsonPrimitive?.content }
        .getOrNull()?.take(300)?.filter { !it.isISOControl() || it == '\n' }
    throw ApiFailure.Http(code(), code, requestId, message, headers()["Retry-After"]?.toIntOrNull())
}

fun <T : Any> Response<T>.requireBody(): T {
    requireSuccess()
    return body() ?: throw ApiFailure.InvalidResponse()
}

fun <T> Response<AuthEnvelope<T>>.requireEnvelope(): AuthEnvelope<T> {
    val envelope = requireBody()
    if (envelope.code != 0) throw ApiFailure.Http(code(), envelope.code, headers()["X-Request-ID"], envelope.message.take(300))
    return envelope
}

fun <T : Any> Response<AuthEnvelope<T>>.requireUserData(): T =
    requireEnvelope().data ?: throw ApiFailure.InvalidResponse()

suspend fun <T> apiCall(block: suspend () -> T): T = try {
    block()
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (known: ApiFailure) {
    throw known
} catch (_: SocketTimeoutException) {
    throw ApiFailure.Network(timedOut = true)
} catch (_: InterruptedIOException) {
    throw ApiFailure.Network(timedOut = true)
} catch (_: IOException) {
    throw ApiFailure.Network(timedOut = false)
} catch (_: SerializationException) {
    throw ApiFailure.InvalidResponse()
}
