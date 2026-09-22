package com.lycoris.maps.core.map

import android.content.Context
import com.lycoris.maps.core.platform.MainlandCoverage
import com.lycoris.maps.core.platform.NavigationCoordinates
import com.lycoris.maps.core.platform.NavigationPoint
import com.tencent.tencentmap.mapsdk.maps.model.CameraPosition
import com.tencent.tencentmap.mapsdk.maps.model.LatLng
import com.tencent.tencentmap.mapsdk.maps.model.LatLngBounds

/** App state/API/drafts stay WGS84. Only Tencent's renderer boundary uses GCJ-02. */
internal class TencentCoordinates(private val conversion: NavigationCoordinates) {
    fun toMap(latitude: Double, longitude: Double): LatLng =
        conversion.wgs84ToGcj02(NavigationPoint(latitude, longitude)).let { LatLng(it.latitude, it.longitude) }

    fun fromMap(point: LatLng): NavigationPoint? =
        conversion.gcj02ToWgs84(NavigationPoint(point.latitude, point.longitude))

    fun camera(value: MapCamera, minZoom: Float = 3f, maxZoom: Float = 20f): CameraPosition =
        CameraPosition(toMap(value.latitude, value.longitude), (value.zoom + 1).toFloat().coerceIn(minZoom, maxZoom),
            value.tilt.coerceIn(0.0, 60.0).toFloat(), value.bearing.toFloat())

    fun camera(value: CameraPosition): MapCamera? = fromMap(value.target)?.let {
        MapCamera(it.latitude, it.longitude, value.zoom.toDouble() - 1, value.bearing.toDouble(), value.tilt.toDouble())
    }

    // The conversion varies across a viewport and is discontinuous at its coverage edge.
    // Pad the geographic query envelope rather than treating just two inverse corners as exact.
    fun queryBounds(bounds: LatLngBounds): MapBounds = MapBounds(
        (bounds.southwest.latitude - 0.02).coerceAtLeast(-90.0),
        (bounds.northeast.latitude + 0.02).coerceAtMost(90.0),
        (bounds.southwest.longitude - 0.02).coerceAtLeast(-180.0),
        (bounds.northeast.longitude + 0.02).coerceAtMost(180.0),
    )

    companion object {
        fun load(context: Context): TencentCoordinates? = runCatching {
            context.assets.open("MainlandCoverage.json").bufferedReader().use { reader ->
                MainlandCoverage.fromJson(reader.readText())?.let { TencentCoordinates(NavigationCoordinates(it)) }
            }
        }.getOrNull()
    }
}
