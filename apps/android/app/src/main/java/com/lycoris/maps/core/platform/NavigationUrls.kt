package com.lycoris.maps.core.platform

import java.net.URLEncoder
import java.util.Locale

data class NavigationDestination(val markerId: Long, val title: String, val latitude: Double, val longitude: Double) {
    init { require(markerId > 0L) }
    val point = NavigationPoint(latitude, longitude)
    val displayTitle: String = title.filterNot { it.isISOControl() }.trim().take(256).ifEmpty { "Lycoris Maps" }
}

enum class NavigationProvider(val packageName: String?) {
    GENERIC(null),
    AMAP("com.autonavi.minimap"),
    BAIDU("com.baidu.BaiduMap"),
    TENCENT("com.tencent.map"),
    GOOGLE("com.google.android.apps.maps"),
}

/** Destination only. Provider apps obtain their own origin after the user chooses them. */
class NavigationUrls(private val coordinates: NavigationCoordinates?) {
    fun generic(destination: NavigationDestination): String {
        val point = pair(destination.point)
        val label = destination.displayTitle.replace('(', '（').replace(')', '）')
        return "geo:$point?q=${encode("$point($label)")}"
    }

    /** Current AMap route URI (2025-10); omitting slat/slon lets that app resolve its own origin. */
    fun amap(destination: NavigationDestination): String {
        val point = coordinates?.wgs84ToGcj02(destination.point) ?: destination.point
        return query("amapuri://route/plan/", listOf(
            "sourceApplication" to "Lycoris Maps", "dlat" to number(point.latitude),
            "dlon" to number(point.longitude), "dname" to destination.displayTitle,
            // Native WGS84 conversion is a supported fallback if the local coverage asset is unavailable.
            "dev" to if (coordinates == null) "1" else "0", "t" to "2", "m" to "0",
        ))
    }

    fun baidu(destination: NavigationDestination): String {
        val mainland = coordinates?.isMainland(destination.point) == true
        val point = if (mainland) coordinates!!.wgs84ToBd09(destination.point) else destination.point
        // The URI has a second, provider-specific grammar inside destination; do not let a label add fields.
        val title = destination.displayTitle.replace('|', '｜').replace(':', '：')
        return query("baidumap://map/direction", listOf(
            "origin" to "我的位置",
            "destination" to "latlng:${pair(point)}|name:$title",
            "mode" to "walking", "coord_type" to if (mainland) "bd09ll" else "wgs84",
            "src" to "andr.lycoris.maps",
        ))
    }

    /** Tencent requires a registered developer key. Never invent one or silently use a public example. */
    fun tencent(destination: NavigationDestination, developerKey: String?): String? {
        val key = developerKey?.trim()?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{10,128}")) } ?: return null
        val point = coordinates?.wgs84ToGcj02(destination.point) ?: return null
        return query("qqmap://map/routeplan", listOf(
            "type" to "walk", "fromcoord" to "CurrentLocation",
            "to" to destination.displayTitle, "tocoord" to pair(point), "referer" to key,
        ))
    }

    fun google(destination: NavigationDestination): String =
        "google.navigation:q=${encode(pair(destination.point))}&mode=w"

    /** A safe OSM destination page, returned for an explicit UI action; never opened automatically. */
    fun webFallback(destination: NavigationDestination): String =
        "https://www.openstreetmap.org/?mlat=${number(destination.latitude)}&mlon=${number(destination.longitude)}" +
            "#map=17/${number(destination.latitude)}/${number(destination.longitude)}"

    fun native(provider: NavigationProvider, destination: NavigationDestination, tencentKey: String? = null): String? = when (provider) {
        NavigationProvider.GENERIC -> generic(destination)
        NavigationProvider.AMAP -> amap(destination)
        NavigationProvider.BAIDU -> baidu(destination)
        NavigationProvider.TENCENT -> tencent(destination, tencentKey)
        NavigationProvider.GOOGLE -> google(destination)
    }

    companion object {
        private fun number(value: Double): String = String.format(Locale.ROOT, "%.7f", if (value == 0.0) 0.0 else value)
        private fun pair(point: NavigationPoint) = "${number(point.latitude)},${number(point.longitude)}"
        private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        private fun query(base: String, parameters: List<Pair<String, String>>): String =
            base + "?" + parameters.joinToString("&") { (key, value) -> "${encode(key)}=${encode(value)}" }
    }
}
