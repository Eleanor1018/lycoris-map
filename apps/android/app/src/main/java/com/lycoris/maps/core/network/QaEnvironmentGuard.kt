package com.lycoris.maps.core.network

import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.serialization.Serializable
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

internal const val QA_ENVIRONMENT = "lycoris-android-synthetic-v1"

/** QA writes fail closed if the local gateway or its synthetic database sentinel is absent. */
internal class QaEnvironmentGuard(private val origin: HttpUrl, private val userAgent: String) : Interceptor {
    init {
        require(origin.scheme == "http" && origin.host in setOf("10.0.2.2", "127.0.0.1", "localhost") && origin.port == 18187) {
            "QA requires the isolated local gateway on port 18187"
        }
    }
    private val preflightClient = OkHttpClient.Builder()
        .cookieJar(CookieJar.NO_COOKIES).cache(null)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .callTimeout(8, TimeUnit.SECONDS).build()

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (!sameOrigin(origin, request.url)) throw IOException("QA origin mismatch")
        if (request.method in setOf("GET", "HEAD", "OPTIONS")) return chain.proceed(request)
        val manifestRequest = Request.Builder()
            .url(origin.resolve("/__lycoris_qa__/manifest")!!)
            .header("User-Agent", userAgent).get().build()
        val nonce = preflightClient.newCall(manifestRequest).execute().use { response ->
            if (response.code != 200 || response.header("X-Lycoris-Test-Environment") != QA_ENVIRONMENT) {
                throw IOException("QA environment unavailable")
            }
            val source = response.body.source()
            source.request(16385)
            if (source.buffer.size > 16384) throw IOException("Invalid QA manifest")
            val manifest = try { LycorisJson.decodeFromString<QaManifest>(source.readUtf8()) } catch (_: Exception) {
                throw IOException("Invalid QA manifest")
            }
            manifest.verifiedNonce()
        }
        return chain.proceed(request.newBuilder()
            .header("X-Lycoris-Test-Environment", QA_ENVIRONMENT)
            .header("X-Lycoris-Test-Nonce", nonce).build())
    }
}

@Serializable
internal data class QaManifest(
    val testEnvironment: String,
    val protocolVersion: Int,
    val instanceNonce: String,
    val upstream: String,
    val sentinel: QaSentinel,
) {
    fun verifiedNonce(): String {
        val validOwner = runCatching { UUID.fromString(sentinel.ownerPublicId).toString() == sentinel.ownerPublicId.lowercase() }.getOrDefault(false)
        if (testEnvironment != QA_ENVIRONMENT || protocolVersion != 1 || !instanceNonce.matches(Regex("[0-9a-f]{64}")) ||
            upstream != "http://127.0.0.1:18186/" || sentinel.markerId <= 0 ||
            sentinel.title != "Android QA Environment Sentinel v1" ||
            sentinel.description != "Synthetic Android QA only. Never production data." ||
            sentinel.clientRequestId != "android-qa-sentinel-v1" || !validOwner
        ) throw IOException("QA sentinel mismatch")
        return instanceNonce
    }
}

@Serializable
internal data class QaSentinel(
    val markerId: Long,
    val title: String,
    val description: String,
    val ownerPublicId: String,
    val clientRequestId: String,
)
