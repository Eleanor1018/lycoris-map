package com.lycoris.maps.core.map

import android.os.Bundle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.camera.CameraUpdateFactory

data class MapCamera(val latitude: Double = 31.2304, val longitude: Double = 121.4737, val zoom: Double = 13.0, val bearing: Double = 0.0, val tilt: Double = 0.0)
data class MapBounds(val south: Double, val north: Double, val west: Double, val east: Double)

class NativeMapState {
    internal var map by mutableStateOf<MapLibreMap?>(null)
    var camera by mutableStateOf(MapCamera())
        internal set
    var ready by mutableStateOf(false)
        internal set
    fun moveTo(latitude: Double, longitude: Double, zoom: Double = camera.zoom) {
        if (!latitude.isFinite() || !longitude.isFinite() || latitude !in -90.0..90.0 || longitude !in -180.0..180.0) return
        val next = CameraPosition.Builder().target(LatLng(latitude, longitude)).zoom(zoom)
            .bearing(camera.bearing).tilt(camera.tilt).build()
        map?.animateCamera(CameraUpdateFactory.newCameraPosition(next))
    }
}

@Composable
fun rememberNativeMapState(): NativeMapState = rememberSaveable(saver = listSaver(
    save = { listOf(it.camera.latitude, it.camera.longitude, it.camera.zoom, it.camera.bearing, it.camera.tilt) },
    restore = { values -> NativeMapState().also { it.camera = MapCamera(values[0], values[1], values[2], values[3], values[4]) } },
)) { NativeMapState() }

/** One native renderer for the screen; panel recomposition must not replace it. */
@Composable
fun MapViewHost(
    modifier: Modifier = Modifier,
    state: NativeMapState = rememberNativeMapState(),
    styleJson: String = MapStyles.osm,
    onCameraIdle: (MapCamera, MapBounds) -> Unit = { _, _ -> },
    onMapClick: (Double, Double) -> Unit = { _, _ -> },
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val idle by rememberUpdatedState(onCameraIdle)
    val clicked by rememberUpdatedState(onMapClick)
    val currentStyle by rememberUpdatedState(styleJson)
    val mapView = remember(context) {
        MapView(context).apply {
            onCreate(Bundle())
            getMapAsync { map ->
                state.map = map
                val restored = state.camera
                map.cameraPosition = CameraPosition.Builder()
                    .target(LatLng(restored.latitude, restored.longitude)).zoom(restored.zoom)
                    .bearing(restored.bearing).tilt(restored.tilt).build()
                map.setStyle(Style.Builder().fromJson(currentStyle)) { state.ready = true }
                map.uiSettings.isLogoEnabled = false
                map.uiSettings.isAttributionEnabled = true
                map.uiSettings.isCompassEnabled = true
                // Attribution stays above the persistent bottom panels (not beneath them).
                map.uiSettings.attributionGravity = android.view.Gravity.TOP or android.view.Gravity.START
                map.uiSettings.setAttributionMargins(8, (122 * resources.displayMetrics.density).toInt(), 0, 0)
                map.addOnCameraIdleListener {
                    val camera = map.cameraPosition
                    val point = camera.target ?: return@addOnCameraIdleListener
                    state.camera = MapCamera(point.latitude, point.longitude, camera.zoom, camera.bearing, camera.tilt)
                    val bounds = map.projection.visibleRegion.latLngBounds
                    idle(state.camera, MapBounds(bounds.latitudeSouth, bounds.latitudeNorth, bounds.longitudeWest, bounds.longitudeEast))
                }
                map.addOnMapClickListener { point -> clicked(point.latitude, point.longitude); true }
            }
        }
    }
    DisposableEffect(mapView, lifecycle) {
        var started = false
        var resumed = false
        fun sync() {
            val shouldStart = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
            val shouldResume = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
            if (!shouldResume && resumed) { mapView.onPause(); resumed = false }
            if (!shouldStart && started) { mapView.onStop(); started = false }
            if (shouldStart && !started) { mapView.onStart(); started = true }
            if (shouldResume && !resumed) { mapView.onResume(); resumed = true }
        }
        val observer = LifecycleEventObserver { _, _ -> sync() }
        lifecycle.addObserver(observer)
        sync()
        onDispose {
            lifecycle.removeObserver(observer)
            if (resumed) mapView.onPause()
            if (started) mapView.onStop()
            mapView.onDestroy()
            state.map = null
            state.ready = false
        }
    }
    androidx.compose.runtime.LaunchedEffect(styleJson, state.map) {
        val map = state.map ?: return@LaunchedEffect
        state.ready = false
        map.setStyle(Style.Builder().fromJson(styleJson)) { state.ready = true }
    }
    AndroidView(factory = { mapView }, modifier = modifier)
}

object MapStyles {
    val osm = """
        {"version":8,"sources":{"osm":{"type":"raster","tiles":["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],"tileSize":256,"maxzoom":19,"attribution":"© OpenStreetMap contributors"}},"layers":[{"id":"osm","type":"raster","source":"osm"}]}
    """.trimIndent()
}
