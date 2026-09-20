package com.lycoris.maps.core.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

interface CookiePersistence {
    fun read(): ByteArray?
    fun write(bytes: ByteArray)
    fun clear()
}

internal class MemoryCookiePersistence : CookiePersistence {
    private var bytes: ByteArray? = null
    override fun read(): ByteArray? = bytes?.clone()
    override fun write(bytes: ByteArray) { this.bytes = bytes.clone() }
    override fun clear() { bytes = null }
}

class CookieSnapshot internal constructor(val epoch: Long, internal val cookies: List<Cookie>)

/**
 * Origin isolation is stricter than a browser's domain-cookie behavior: no API cookie ever
 * leaves this exact scheme/host/port. The transport uses epoch snapshots to reject late
 * Set-Cookie responses from an account that has since signed out.
 */
class SessionCookieJar(
    val origin: HttpUrl,
    private val persistence: CookiePersistence,
    private val now: () -> Long = System::currentTimeMillis,
) : CookieJar {
    private var cookies: List<Cookie> = emptyList()
    private var restored = false
    private var generation = 0L

    @Synchronized
    fun restore() {
        if (restored) return
        cookies = try {
            persistence.read()?.let { bytes ->
                LycorisJson.decodeFromString<List<StoredCookie>>(bytes.decodeToString())
                    .mapNotNull { it.cookie() }.filter(::validPersistentCookie)
            }.orEmpty()
        } catch (_: Exception) {
            // A removed/invalidated Keystore key requires sign-in; never use plaintext fallback.
            emptyList()
        }
        restored = true
    }

    @Synchronized
    fun epoch(): Long = generation

    @Synchronized
    fun snapshot(url: HttpUrl): CookieSnapshot {
        restore()
        return CookieSnapshot(generation, loadForRequest(url))
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        restore()
        if (!sameOrigin(origin, url)) return emptyList()
        return cookies.filter { it.expiresAt > now() && it.matches(url) }
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        saveFromResponse(url, cookies, generation)
    }

    @Synchronized
    fun saveFromResponse(url: HttpUrl, incoming: List<Cookie>, expectedEpoch: Long) {
        if (expectedEpoch != generation || !sameOrigin(origin, url) || incoming.isEmpty()) return
        restore()
        val current = cookies.filter { it.expiresAt > now() }.toMutableList()
        for (cookie in incoming) {
            // A cookie's Path can be more specific than this response URL. Its domain still
            // has to match our sole origin before it is stored.
            if (!domainMatches(cookie)) continue
            current.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
            if (cookie.expiresAt > now()) current += cookie
        }
        persist(current)
        cookies = current
    }

    /** Invalidate late responses even when preserving a session for a retryable service error. */
    @Synchronized
    fun advanceEpoch(clear: Boolean = false): Long {
        if (clear) {
            // Clear memory first even if disk storage has failed; do not continue a stale session.
            cookies = emptyList()
            generation++
            restored = true
            try { persistence.clear() } catch (_: Exception) { throw ApiFailure.SecureStorage() }
        } else {
            generation++
        }
        return generation
    }

    @Synchronized
    fun hasCookies(): Boolean {
        restore()
        return cookies.any { it.expiresAt > now() }
    }

    private fun persist(value: List<Cookie>) {
        try {
            persistence.write(LycorisJson.encodeToString(value.filter(::validPersistentCookie).map(StoredCookie::from)).encodeToByteArray())
        } catch (_: Exception) {
            throw ApiFailure.SecureStorage()
        }
    }

    private fun domainMatches(cookie: Cookie): Boolean = if (cookie.hostOnly) {
        cookie.domain == origin.host
    } else {
        origin.host == cookie.domain || origin.host.endsWith(".${cookie.domain}")
    }

    private fun validPersistentCookie(cookie: Cookie): Boolean =
        cookie.persistent && cookie.expiresAt > now() && domainMatches(cookie) && (!cookie.secure || origin.isHttps)
}

fun sameOrigin(first: HttpUrl, second: HttpUrl): Boolean =
    first.scheme == second.scheme && first.host == second.host && first.port == second.port

@Serializable
private data class StoredCookie(
    val name: String,
    val value: String,
    val domain: String,
    val path: String,
    val secure: Boolean,
    val httpOnly: Boolean,
    val hostOnly: Boolean,
    val expiresAt: Long,
) {
    fun cookie(): Cookie? = runCatching {
        Cookie.Builder().name(name).value(value).path(path).expiresAt(expiresAt).apply {
            if (hostOnly) hostOnlyDomain(domain) else domain(domain)
            if (secure) secure()
            if (httpOnly) httpOnly()
        }.build()
    }.getOrNull()

    companion object {
        fun from(cookie: Cookie): StoredCookie = StoredCookie(
            cookie.name, cookie.value, cookie.domain, cookie.path, cookie.secure,
            cookie.httpOnly, cookie.hostOnly, cookie.expiresAt,
        )
    }
}
