package com.lycoris.maps.core.network

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

enum class ImageVariant(val query: String) { ORIGINAL("original"), THUMB("thumb"), DETAIL("detail") }
data class MediaResource(val url: HttpUrl, val mayNeedSession: Boolean)

class MediaUrlResolver(private val origin: HttpUrl, private val publicMediaHosts: Set<String> = emptySet()) {
    fun resolve(value: String?, variant: ImageVariant = ImageVariant.ORIGINAL): MediaResource? {
        val input = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        if (input.contains('\\') || input.startsWith("//") || input.any(Char::isISOControl)) return null
        val url = if (input.startsWith("/")) origin.resolve(input) else input.toHttpUrlOrNull()
        url ?: return null
        if (url.username.isNotEmpty() || url.password.isNotEmpty() || url.fragment != null) return null
        val ownOrigin = sameOrigin(origin, url)
        if (!ownOrigin && (!url.isHttps || url.host !in publicMediaHosts)) return null
        if (ownOrigin) {
            val upload = url.encodedPath.matches(Regex("/uploads/(markers|avatars)/[^/]+"))
            val avatarApi = url.encodedPath == "/api/me/avatar" || url.encodedPath.matches(Regex("/api/users/[^/]+/avatar"))
            if (!upload && !avatarApi) return null
            val resolved = if (upload && variant != ImageVariant.ORIGINAL) {
                // Supported by backend/src/routes/uploads.rs and media/renditions.rs on main.
                url.newBuilder().setQueryParameter("variant", variant.query).build()
            } else url
            return MediaResource(resolved, url.encodedPath.startsWith("/uploads/markers/") || url.encodedPath == "/api/me/avatar")
        }
        // A signed external media URL is used exactly as supplied; never append guessed variants.
        return MediaResource(url, mayNeedSession = false)
    }
}
