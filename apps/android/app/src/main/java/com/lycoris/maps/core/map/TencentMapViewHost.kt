package com.lycoris.maps.core.map

import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.tencent.tencentmap.mapsdk.maps.CameraUpdateFactory
import com.tencent.tencentmap.mapsdk.maps.MapView
import com.tencent.tencentmap.mapsdk.maps.TencentMap
import com.tencent.tencentmap.mapsdk.maps.TencentMapInitializer
import com.tencent.tencentmap.mapsdk.maps.TencentMapOptions
import com.tencent.tencentmap.mapsdk.maps.model.CameraPosition

private object TencentSdk {
    private var started = false
    @Synchronized fun start(context: android.content.Context) {
        if (started) return
        TencentMapInitializer.setAgreePrivacy(context.applicationContext, true)
        TencentMapInitializer.start(context.applicationContext)
        started = true
    }
}

/** Constructed only after the app has recorded the user's Tencent privacy choice. */
@Composable
fun TencentMapViewHost(
    modifier: Modifier = Modifier,
    state: NativeMapState,
    topPaddingPx: Int = 0,
    bottomPaddingPx: Int = 0,
    onCameraIdle: (MapCamera, MapBounds) -> Unit = { _, _ -> },
    onMapClick: (Double, Double) -> Unit = { _, _ -> },
    onUserGesture: () -> Unit = {},
    onTilesLoaded: () -> Unit = {},
    onUnavailable: () -> Unit = {},
    onAuthorized: () -> Unit = {},
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val idle by rememberUpdatedState(onCameraIdle)
    val clicked by rememberUpdatedState(onMapClick)
    val gesture by rememberUpdatedState(onUserGesture)
    val loaded by rememberUpdatedState(onTilesLoaded)
    val unavailable by rememberUpdatedState(onUnavailable)
    val authorized by rememberUpdatedState(onAuthorized)
    val top by rememberUpdatedState(topPaddingPx)
    val bottom by rememberUpdatedState(bottomPaddingPx)
    val coordinates = remember(context) { TencentCoordinates.load(context) }
    val handler = remember { Handler(Looper.getMainLooper()) }
    val alive = remember { booleanArrayOf(true) }
    val authFailed = remember { booleanArrayOf(false) }
    val view = remember(context, state, coordinates) {
        if (coordinates == null) null else try {
            TencentSdk.start(context)
            MapView(context, TencentMapOptions().setForceHttps(true).setOnAuthCallback(object : TencentMap.OnAuthResultCallback {
                override fun onAuthSuccess() { handler.post { if (alive[0]) authorized() } }
                override fun onAuthFail(code: Int, message: String?) {
                    // The SDK's message may include credentials. Do not log it.
                    handler.post {
                        if (alive[0]) { authFailed[0] = true; unavailable() }
                    }
                }
            }))
        } catch (_: RuntimeException) { null } catch (_: LinkageError) { null }
    }
    if (view == null || coordinates == null) {
        LaunchedEffect(state) { unavailable() }
        Box(modifier)
        return
    }
    val map = remember(view) { view.map }
    fun positionControls() {
        val inset = (8 * context.resources.displayMetrics.density).toInt()
        // Move provider credit above the sheet without moving the geographic camera.
        val safeBottom = bottom.coerceAtMost((view.height - top - inset * 5).coerceAtLeast(inset))
        map.uiSettings.setLogoPositionWithMargin(TencentMapOptions.LOGO_POSITION_BOTTOM_LEFT, 0, safeBottom + inset, inset, 0)
        map.uiSettings.setCompassExtraPadding(inset, top + inset)
    }
    DisposableEffect(view, lifecycle, state) {
        var started = false
        var resumed = false
        alive[0] = true
        state.ready = false
        state.tencentCoordinates = coordinates
        state.tencentMap = map
        fun emitCamera(position: CameraPosition, finished: Boolean) {
            if (!alive[0] || state.tencentMap !== map) return
            val camera = coordinates.camera(position) ?: return
            state.camera = camera
            if (finished && view.width > 0 && view.height > 0) idle(camera, coordinates.queryBounds(map.projection.visibleRegion.latLngBounds))
        }
        fun sync() {
            val start = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
            val resume = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
            if (!resume && resumed) { view.onPause(); resumed = false }
            if (!start && started) { view.onStop(); started = false }
            if (start && !started) { view.onStart(); started = true }
            if (resume && !resumed) { view.onResume(); resumed = true }
        }
        val observer = LifecycleEventObserver { _, _ -> sync() }
        val layout = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            if (alive[0]) positionControls()
        }
        map.uiSettings.apply {
            isZoomControlsEnabled = false
            isMyLocationButtonEnabled = false
            isCompassEnabled = true
            isScaleViewEnabled = false
        }
        map.setOnCameraChangeListener(object : TencentMap.OnCameraChangeListener {
            override fun onCameraChange(position: CameraPosition) {
                if (position.triggers?.contains(CameraPosition.Trigger.GESTURE) == true) gesture()
                emitCamera(position, false)
            }
            override fun onCameraChangeFinished(position: CameraPosition) = emitCamera(position, true)
        })
        map.setOnMapClickListener { point ->
            if (alive[0] && state.tencentMap === map) coordinates.fromMap(point)?.let { clicked(it.latitude, it.longitude) }
        }
        map.setOnMapPoiClickListener { poi ->
            if (alive[0] && state.tencentMap === map) coordinates.fromMap(poi.position)?.let { clicked(it.latitude, it.longitude) }
        }
        map.setOnMapLoadedCallback {
            handler.post {
                if (alive[0] && state.tencentMap === map && !authFailed[0]) { loaded(); emitCamera(map.cameraPosition, true) }
            }
        }
        map.moveCamera(CameraUpdateFactory.newCameraPosition(coordinates.camera(state.camera, map.minZoomLevel, map.maxZoomLevel)))
        state.ready = true
        view.addOnLayoutChangeListener(layout)
        lifecycle.addObserver(observer)
        sync()
        onDispose {
            alive[0] = false
            lifecycle.removeObserver(observer)
            view.removeOnLayoutChangeListener(layout)
            if (state.tencentMap === map) {
                if (state.map == null && state.googleMap == null) {
                    coordinates.camera(map.cameraPosition)?.let { state.camera = it }
                    state.ready = false
                }
                state.tencentMap = null
                state.tencentCoordinates = null
            }
            map.setOnCameraChangeListener(null)
            map.setOnMapClickListener(null)
            map.setOnMapPoiClickListener(null)
            map.setOnMapLoadedCallback(null)
            if (resumed) view.onPause()
            if (started) view.onStop()
            view.onDestroy()
        }
    }
    AndroidView(factory = { view }, modifier = modifier, update = { if (alive[0]) positionControls() })
}
