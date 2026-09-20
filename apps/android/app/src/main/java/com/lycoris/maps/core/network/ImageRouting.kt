package com.lycoris.maps.core.network

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Only approved public uploads can use the production Pages Worker in front of R2. */
internal class ImageRouting(private val origin: HttpUrl, testEnvironment: Boolean) {
    private val workerOrigin = "https://lycoris-map.com/".toHttpUrl()
    private val production = !testEnvironment && (
        sameOrigin(origin, "https://api.lycoris-map.com/".toHttpUrl()) || sameOrigin(origin, workerOrigin)
    )
    private val publicOrigin = if (production) workerOrigin else origin

    fun resolve(value: String?, variant: ImageVariant, publiclyVisible: Boolean): MediaResource? {
        val input = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        if (input.startsWith("//") || input.contains('\\') || input.any(Char::isISOControl)) return null
        val url = (if (input.startsWith("/")) origin.resolve(input) else input.toHttpUrlOrNull()) ?: return null
        if (!safeUpload(url)) return null
        if (!sameOrigin(origin, url) && !(production && sameOrigin(workerOrigin, url))) return null
        val target = if (publiclyVisible) publicOrigin else origin
        // Only documented rendition parameters survive. In particular, never forward signed
        // external URLs or arbitrary query credentials between the API and Pages origins.
        val resolved = target.newBuilder().encodedPath(url.encodedPath).apply {
            if (variant != ImageVariant.ORIGINAL) setQueryParameter("variant", variant.query)
        }.build()
        return MediaResource(resolved, mayNeedSession = !publiclyVisible)
    }

    fun allowsPublicRequest(url: HttpUrl): Boolean =
        sameOrigin(publicOrigin, url) && safeUpload(url) &&
            url.queryParameterNames.all { it == "variant" } &&
            url.queryParameterValues("variant").let { variants ->
                variants.isEmpty() || (variants.size == 1 && ImageVariant.entries.any { it.query == variants.single() })
            }

    private fun safeUpload(url: HttpUrl): Boolean =
        url.username.isEmpty() && url.password.isEmpty() && url.fragment == null &&
            UPLOAD_PATH.matches(url.encodedPath)

    private companion object {
        // Matches the deployed Pages Worker's public media route, with no encoded separators.
        val UPLOAD_PATH = Regex("/uploads/(markers|avatars)/[A-Za-z0-9_.-]+\\.(?:jpe?g|png|webp|gif)", RegexOption.IGNORE_CASE)
    }
}
