package com.lycoris.maps.core.map

import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.GoogleMapOptions
import com.google.android.gms.maps.MapView
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng

/**
 * NativeMapState uses MapLibre's 512-pixel world. Google uses 256, hence the one-level offset.
 * Keeping conversion here also gives moveTo/saved-state code one definition of the shared camera.
 */
internal fun MapCamera.toGoogleCameraPosition(
    minZoom: Float = Float.NEGATIVE_INFINITY,
    maxZoom: Float = Float.POSITIVE_INFINITY,
): CameraPosition = CameraPosition.Builder()
    .target(LatLng(latitude, longitude)).zoom((zoom + 1.0).toFloat().coerceIn(minZoom, maxZoom))
    .bearing(bearing.toFloat()).tilt(tilt.coerceIn(0.0, 90.0).toFloat()).build()

internal fun CameraPosition.toNativeCamera() = MapCamera(
    target.latitude, target.longitude, zoom.toDouble() - 1.0, bearing.toDouble(), tilt.toDouble(),
)

/**
 * A provider switch owns a new MapView; ordinary panels/recompositions keep this one mounted.
 * ready denotes a usable GoogleMap object. Only onTilesLoaded reports the SDK's rendered-map event.
 */
@Composable
fun GoogleMapViewHost(
    modifier: Modifier = Modifier,
    state: NativeMapState = rememberNativeMapState(),
    onCameraIdle: (MapCamera, MapBounds) -> Unit = { _, _ -> },
    onMapClick: (Double, Double) -> Unit = { _, _ -> },
    onUserGesture: () -> Unit = {},
    bottomPaddingPx: Int = 0,
    topPaddingPx: Int = 0,
    onTilesLoaded: () -> Unit = {},
    onUnavailable: () -> Unit = {},
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val idle by rememberUpdatedState(onCameraIdle)
    val clicked by rememberUpdatedState(onMapClick)
    val gesture by rememberUpdatedState(onUserGesture)
    val loaded by rememberUpdatedState(onTilesLoaded)
    val unavailable by rememberUpdatedState(onUnavailable)
    val topPadding by rememberUpdatedState(topPaddingPx)
    val bottomPadding by rememberUpdatedState(bottomPaddingPx)
    val savedView = rememberSaveable(saver = GoogleViewSavedState.Saver) { GoogleViewSavedState() }
    val mapView = remember(context, state) {
        try {
            MapView(context, GoogleMapOptions().camera(state.camera.toGoogleCameraPosition()))
        } catch (_: RuntimeException) {
            null
        } catch (_: LinkageError) {
            null
        }
    }
    if (mapView == null) {
        LaunchedEffect(state) { if (state.map == null) state.ready = false; unavailable() }
        Box(modifier)
        return
    }
    val paddingController = remember(mapView) { GoogleMapPaddingController() }
    val attachedMap = remember(mapView) { arrayOfNulls<GoogleMap>(1) }

    DisposableEffect(mapView, lifecycle, state) {
        var alive = true
        var initialized = false
        var started = false
        var resumed = false
        var failed = false
        var ownedMap: GoogleMap? = null
        state.ready = false

        fun fail() {
            if (!alive || failed) return
            failed = true
            if (state.googleMap === ownedMap && state.map == null) state.ready = false
            unavailable()
        }
        fun applyPadding() {
            val map = ownedMap ?: return
            paddingController.apply(map, mapView.height, context.resources.displayMetrics.density, topPadding, bottomPadding)
        }
        fun emitCamera() {
            val map = ownedMap ?: return
            if (!alive || failed || state.googleMap !== map || state.map != null || mapView.width <= 0 || mapView.height <= 0) return
            state.camera = map.cameraPosition.toNativeCamera()
            val bounds = map.projection.visibleRegion.latLngBounds
            idle(state.camera, MapBounds(bounds.southwest.latitude, bounds.northeast.latitude,
                bounds.southwest.longitude, bounds.northeast.longitude))
        }
        fun syncLifecycle() {
            if (!initialized || failed) return
            try {
                val shouldStart = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
                val shouldResume = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
                if (!shouldResume && resumed) { mapView.onPause(); resumed = false }
                if (!shouldStart && started) { mapView.onStop(); started = false }
                if (shouldStart && !started) { mapView.onStart(); started = true }
                if (shouldResume && !resumed) { mapView.onResume(); resumed = true }
            } catch (_: RuntimeException) { fail() }
        }
        val observer = LifecycleEventObserver { _, _ -> syncLifecycle() }
        val memory = object : ComponentCallbacks2 {
            override fun onConfigurationChanged(configuration: Configuration) = Unit
            override fun onLowMemory() {
                if (alive && initialized && !failed) try { mapView.onLowMemory() } catch (_: RuntimeException) { fail() }
            }
            override fun onTrimMemory(level: Int) {
                if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) onLowMemory()
            }
        }
        val layout = View.OnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
            if (alive && !failed && (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop)) {
                try { applyPadding(); emitCamera() } catch (_: RuntimeException) { fail() }
            }
        }
        mapView.addOnLayoutChangeListener(layout)
        context.applicationContext.registerComponentCallbacks(memory)
        lifecycle.addObserver(observer)
        try {
            mapView.onCreate(savedView.bundle)
            initialized = true
            savedView.view = mapView
            mapView.getMapAsync { map ->
                if (!alive || failed) return@getMapAsync
                try {
                    ownedMap = map
                    attachedMap[0] = map
                    state.googleMap = map
                    map.uiSettings.apply {
                        isCompassEnabled = true
                        isZoomControlsEnabled = false
                        isMapToolbarEnabled = false
                        isIndoorLevelPickerEnabled = false
                        // Location is supplied by the existing no-GMS controller and renderer.
                        isMyLocationButtonEnabled = false
                    }
                    map.setOnCameraMoveStartedListener { reason ->
                        if (alive && !failed && reason == GoogleMap.OnCameraMoveStartedListener.REASON_GESTURE) gesture()
                    }
                    map.setOnCameraIdleListener { if (alive && !failed) emitCamera() }
                    map.setOnMapClickListener { point -> if (alive && !failed) clicked(point.latitude, point.longitude) }
                    map.setOnPoiClickListener { poi -> if (alive && !failed) clicked(poi.latLng.latitude, poi.latLng.longitude) }
                    map.setOnMapLoadedCallback { if (alive && !failed && state.googleMap === map) loaded() }
                    applyPadding()
                    map.moveCamera(CameraUpdateFactory.newCameraPosition(state.camera.toGoogleCameraPosition(map.minZoomLevel, map.maxZoomLevel)))
                    state.ready = true
                    emitCamera()
                } catch (_: RuntimeException) { fail() }
            }
            syncLifecycle()
        } catch (_: RuntimeException) { fail() }
        catch (_: LinkageError) { fail() }

        onDispose {
            alive = false
            lifecycle.removeObserver(observer)
            context.applicationContext.unregisterComponentCallbacks(memory)
            mapView.removeOnLayoutChangeListener(layout)
            ownedMap?.let { map ->
                if (state.googleMap === map) {
                    if (state.map == null) {
                        runCatching { state.camera = map.cameraPosition.toNativeCamera() }
                        state.ready = false
                    }
                    state.googleMap = null
                }
                runCatching {
                    map.setOnCameraMoveStartedListener(null)
                    map.setOnCameraIdleListener(null)
                    map.setOnMapClickListener(null)
                    map.setOnPoiClickListener(null)
                    map.setOnMapLoadedCallback(null)
                }
            }
            attachedMap[0] = null
            savedView.snapshot()
            savedView.view = null
            if (resumed) runCatching { mapView.onPause() }
            if (started) runCatching { mapView.onStop() }
            runCatching { mapView.onDestroy() }
        }
    }

    // Sheet/inset changes move the SDK's logo, copyright and compass, never hide them.
    AndroidView(factory = { mapView }, modifier = modifier, update = { view ->
        attachedMap[0]?.takeIf { state.ready && state.googleMap === it && state.map == null }?.let { map ->
            try {
                paddingController.apply(map, view.height, context.resources.displayMetrics.density, topPaddingPx, bottomPaddingPx)
            } catch (_: RuntimeException) { state.ready = false; unavailable() }
        }
    })
}

/** Leave a real map area when the keyboard/sheet briefly exceeds the available height. */
internal fun googleMapPadding(heightPx: Int, density: Float, topPx: Int, bottomPx: Int): Pair<Int, Int> {
    val budget = (heightPx - 48 * density).toInt().coerceAtLeast(0)
    val top = topPx.coerceIn(0, budget)
    return top to bottomPx.coerceIn(0, budget - top)
}

private class GoogleMapPaddingController {
    private var owner: GoogleMap? = null
    private var lastPadding: Pair<Int, Int>? = null
    fun apply(map: GoogleMap, height: Int, density: Float, top: Int, bottom: Int) {
        if (height <= 0) return
        val next = googleMapPadding(height, density, top, bottom)
        if (owner === map && lastPadding == next) return
        // setPadding changes the camera's reported target. Reapply its geographic camera to keep
        // a sheet/IME resize from changing the selected place or the saved provider-switch target.
        val camera = map.cameraPosition
        map.setPadding(0, next.first, 0, next.second)
        map.moveCamera(CameraUpdateFactory.newCameraPosition(camera))
        owner = map
        lastPadding = next
    }
}

/** Forwards the MapView save callback through Compose's Activity-backed save registry. */
private class GoogleViewSavedState(var bundle: Bundle? = null) {
    var view: MapView? = null
    fun snapshot(): Bundle {
        val next = Bundle(bundle ?: Bundle())
        try { view?.onSaveInstanceState(next) } catch (_: RuntimeException) { /* Retain the last valid state. */ }
        bundle = next
        return next
    }
    companion object {
        val Saver = Saver<GoogleViewSavedState, Bundle>(save = { it.snapshot() }, restore = { GoogleViewSavedState(it) })
    }
}
