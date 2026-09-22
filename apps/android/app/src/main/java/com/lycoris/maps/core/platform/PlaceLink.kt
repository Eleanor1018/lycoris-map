package com.lycoris.maps.core.platform

import java.net.URI
import java.net.URLDecoder

/** Web's /maps?markerId=… share format plus iOS's lycoris://maps custom scheme. */
data class PlaceLink private constructor(val markerId: Long) {
    companion object {
        const val PUBLIC_HOST = "lycoris-map.com"
        private val idSyntax = Regex("[1-9][0-9]*")

        fun parse(value: String?): PlaceLink? {
            if (value == null || value.length > 2048 || value.any { it.isWhitespace() || it.code < 0x20 }) return null
            val uri = runCatching { URI(value) }.getOrNull() ?: return null
            if (uri.isOpaque || uri.rawUserInfo != null || uri.port != -1 || uri.rawFragment != null) return null
            val host = uri.host ?: return null
            // Checking the raw authority also rejects escaped/deceptive hosts and empty ports.
            if (!uri.rawAuthority.equals(host, ignoreCase = true)) return null
            when (uri.scheme?.lowercase(java.util.Locale.ROOT)) {
                "https" -> if (!host.equals(PUBLIC_HOST, ignoreCase = true) || uri.rawPath != "/maps") return null
                "lycoris" -> if (!host.equals("maps", ignoreCase = true) || uri.rawPath !in setOf("", "/")) return null
                else -> return null
            }
            val query = uri.rawQuery ?: return null
            val fields = linkedMapOf<String, String>()
            for (field in query.split('&')) {
                val pair = field.split('=', limit = 2)
                if (pair.size != 2) return null
                val name = decode(pair[0]) ?: return null
                val content = decode(pair[1]) ?: return null
                if (name !in setOf("markerId", "lang") || fields.put(name, content) != null) return null
            }
            if (fields["lang"]?.let { it !in setOf("en", "zh") } == true) return null
            val rawId = fields["markerId"] ?: return null
            if (!idSyntax.matches(rawId)) return null
            val id = rawId.toLongOrNull()?.takeIf { it > 0L } ?: return null
            return PlaceLink(id)
        }

        /** Never share preview hosts, account/session query parameters, or the user's location. */
        fun shareUrl(markerId: Long, language: String? = null): String {
            require(markerId > 0L) { "Invalid marker ID" }
            require(language == null || language in setOf("en", "zh")) { "Unsupported language" }
            return "https://$PUBLIC_HOST/maps?markerId=$markerId" + (language?.let { "&lang=$it" } ?: "")
        }

        private fun decode(value: String): String? =
            runCatching { URLDecoder.decode(value, "UTF-8") }.getOrNull()
    }
}
