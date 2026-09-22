package com.lycoris.maps.core.map

import com.lycoris.maps.core.model.GeoBounds
import com.lycoris.maps.core.model.Language
import kotlin.math.floor

data class ViewportRequest(val bounds: GeoBounds, val band: Int, val language: Language)

/** Coverage is promoted only after success. Failed requests must remain eligible for retry. */
class ViewportPolicy {
    private var successful: ViewportRequest? = null
    private var pending: ViewportRequest? = null

    fun request(visible: GeoBounds, zoom: Double, language: Language, force: Boolean = false): ViewportRequest? {
        val band = floor(zoom / 2.0).toInt()
        // A pending request for a different region must be superseded, even when the camera
        // returns to an older successful region; its response would otherwise replace visible pins.
        val reusable = pending ?: successful
        if (!force && reusable?.let { it.band == band && it.language == language && it.bounds.covers(visible) } == true) return null
        val request = ViewportRequest(visible.buffered(), band, language)
        pending = request
        return request
    }
    fun complete(request: ViewportRequest, success: Boolean) {
        if (pending != request) return
        pending = null
        if (success) successful = request
    }
    fun invalidate() { successful = null; pending = null }
}

private fun GeoBounds.covers(other: GeoBounds): Boolean = south <= other.south && north >= other.north &&
    other.segments().all { segment -> segments().any { it.west <= segment.west && it.east >= segment.east } }

private fun GeoBounds.buffered(): GeoBounds {
    val latitudePad = (north - south) * 0.35
    val longitudeWidth = if (west <= east) east - west else 360 - west + east
    val westPadded = west - longitudeWidth * 0.35
    val eastPadded = east + longitudeWidth * 0.35
    val fullWorld = longitudeWidth * 1.7 >= 360
    fun wrap(value: Double) = ((value + 180) % 360 + 360) % 360 - 180
    return GeoBounds((south - latitudePad).coerceAtLeast(-90.0), (north + latitudePad).coerceAtMost(90.0),
        if (fullWorld) -180.0 else wrap(westPadded), if (fullWorld) 180.0 else wrap(eastPadded))
}
