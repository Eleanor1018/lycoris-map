package com.lycoris.maps.core.data.preferences

import com.lycoris.maps.core.model.Language

enum class MapSource {
    OSM, TIANDITU, GOOGLE, TENCENT;

    fun title(language: Language): String = when (this) {
        OSM -> "OSM"
        TIANDITU -> if (language == Language.ZH) "天地图" else "Tianditu"
        GOOGLE -> "Google Maps"
        TENCENT -> if (language == Language.ZH) "腾讯地图" else "Tencent Maps"
    }
}

/** Only an explicit user choice is stored. Language changes keep following the default otherwise. */
fun resolveMapSource(stored: String?, language: Language, available: Set<MapSource>): MapSource {
    val manual = MapSource.entries.firstOrNull { it.name == stored }
    if (manual != null && manual in available) return manual
    return if (language == Language.ZH && MapSource.TENCENT in available) MapSource.TENCENT else MapSource.OSM
}
