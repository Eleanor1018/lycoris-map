package com.lycoris.maps.core.map

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.SystemClock
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.model.BitmapDescriptor
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.Circle
import com.google.android.gms.maps.model.CircleOptions
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.MarkerOptions
import com.lycoris.maps.core.device.DeviceLocation
import com.lycoris.maps.core.designsystem.LycorisNativeFonts
import com.lycoris.maps.core.device.HeadingState
import com.lycoris.maps.core.device.LocationFixPolicy
import com.lycoris.maps.core.model.Marker
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlin.math.min
import kotlin.math.roundToInt
import com.google.android.gms.maps.model.Marker as GoogleMarker

/** App data remains identical across providers; only native drawing primitives differ. */
@Composable
fun GooglePlaceLayers(
    state: NativeMapState,
    places: List<Marker>,
    onSelect: (Long) -> Unit,
    location: DeviceLocation? = null,
    heading: HeadingState? = null,
    onPickCoordinate: ((Double, Double) -> Unit)? = null,
) {
    val context = LocalContext.current
    val density = LocalDensity.current.density
    val clusterTypeface = remember(context) { LycorisNativeFonts.medium(context) }
    val selected by rememberUpdatedState(onSelect)
    val pick by rememberUpdatedState(onPickCoordinate)
    val map = state.googleMap
    val ready = state.ready
    val band = PlaceClustering.zoomBand(state.camera.zoom)
    val bitmaps by produceState<PlaceBitmaps?>(null, context, density) {
        value = try {
            PlaceBitmaps.load(context)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            Log.e("LycorisMap", "Bundled Figma map artwork could not be decoded", error)
            null
        }
    }
    val renderer = remember(state, map, density, clusterTypeface) {
        map?.let { GooglePlaceRenderer(state, it, density, clusterTypeface,
            onSelect = { selected(it) },
            onPick = { latitude, longitude ->
                val callback = pick
                if (callback == null) false else { callback(latitude, longitude); true }
            }) }
    }
    DisposableEffect(renderer) {
        renderer?.listen()
        onDispose { renderer?.dispose() }
    }
    LaunchedEffect(renderer, ready, bitmaps) {
        withContext(Dispatchers.Main.immediate) { if (ready) renderer?.attach(bitmaps) }
    }
    LaunchedEffect(renderer, ready, places, band) {
        if (renderer != null && ready) {
            val symbols = withContext(Dispatchers.Default) { PlaceClustering.cluster(places, band.toDouble()) }
            withContext(Dispatchers.Main.immediate) { renderer.updatePlaces(symbols) }
        }
    }
    LaunchedEffect(renderer, ready, location) {
        val now = SystemClock.elapsedRealtimeNanos()
        val valid = location?.takeIf { LocationFixPolicy.isValid(it, now) }
        withContext(Dispatchers.Main.immediate) { renderer?.updateLocation(valid) }
        if (valid != null) {
            delay((LocationFixPolicy.MAX_AGE_MILLIS - valid.ageMillis(now) + 1).coerceAtLeast(1))
            withContext(Dispatchers.Main.immediate) { renderer?.updateLocation(null) }
        }
    }
    LaunchedEffect(renderer, ready, heading) {
        val now = SystemClock.elapsedRealtimeNanos()
        val degrees = reliableHeadingDegrees(heading, now)
        withContext(Dispatchers.Main.immediate) { renderer?.updateHeading(degrees) }
        if (degrees != null) {
            val remaining = ((heading!!.elapsedRealtimeNanos!! + 2_000_000_000L - now) / 1_000_000L + 1).coerceAtLeast(1)
            delay(remaining)
            withContext(Dispatchers.Main.immediate) { renderer?.updateHeading(null) }
        }
    }
}

/**
 * Owns only Lycoris overlays and the marker/camera-move listeners. The host owns idle, gesture-start,
 * map-click and tile-loaded callbacks. No map.clear(): provider-owned overlays must not be removed.
 */
private class GooglePlaceRenderer(
    private val state: NativeMapState,
    private val map: GoogleMap,
    private val density: Float,
    private val clusterTypeface: Typeface,
    private val onSelect: (Long) -> Unit,
    private val onPick: (Double, Double) -> Boolean,
) {
    private var disposed = false
    private var listening = false
    private var artwork: PlaceBitmaps? = null
    private var symbols = emptyMap<String, PlaceSymbol>()
    private val markers = LinkedHashMap<String, GoogleMarker>()
    private val descriptors = LinkedHashMap<String, BitmapDescriptor>()
    private var accuracy: Circle? = null
    private var dot: GoogleMarker? = null
    private var cone: GoogleMarker? = null
    private var location: DeviceLocation? = null
    private var heading: Double? = null
    private val active: Boolean get() = !disposed && state.ready && state.googleMap === map && state.map == null && state.tencentMap == null

    fun listen() {
        if (!active || listening) return
        listening = true
        map.setOnMarkerClickListener { marker ->
            if (!active) return@setOnMarkerClickListener true
            if (onPick(marker.position.latitude, marker.position.longitude)) return@setOnMarkerClickListener true
            val symbol = symbols[marker.tag as? String] ?: return@setOnMarkerClickListener true
            if (symbol.clustered) {
                state.moveTo(symbol.latitude, symbol.longitude, min(state.camera.zoom + 2.0, 20.0))
            } else {
                onSelect(symbol.memberIds.single())
            }
            // Disable Google's default camera shift, info window and external map toolbar.
            true
        }
        map.setOnCameraMoveListener { if (active) drawHeading() }
    }

    fun attach(bitmaps: PlaceBitmaps?) {
        if (!active) return
        if (artwork !== bitmaps) {
            artwork = bitmaps
            descriptors.clear()
        }
        drawPlaces()
        drawLocation()
        drawHeading()
    }

    fun updatePlaces(value: List<PlaceSymbol>) {
        if (disposed) return
        symbols = value.associateBy { it.key }
        drawPlaces()
    }

    fun updateLocation(value: DeviceLocation?) {
        if (disposed) return
        location = value
        drawLocation()
        drawHeading()
    }

    fun updateHeading(value: Double?) {
        if (disposed) return
        heading = value
        drawHeading()
    }

    private fun drawPlaces() {
        if (!active) return
        val obsolete = markers.keys.filter { it !in symbols }
        obsolete.forEach { markers.remove(it)?.remove() }
        val requiredIcons = HashSet<String>()
        symbols.forEach { (key, symbol) ->
            val isPin = !symbol.clustered && artwork != null
            val imageKey = if (symbol.clustered) "cluster:${symbol.category}:${symbol.count}"
                else if (isPin) "pin:${symbol.category}" else "fallback:${symbol.category}"
            requiredIcons.add(imageKey)
            val icon = descriptors.getOrPut(imageKey) {
                BitmapDescriptorFactory.fromBitmap(when {
                    symbol.clustered -> clusterBitmap(symbol.count, symbol.category, density, clusterTypeface)
                    isPin -> artwork!!.pins.getValue(symbol.category!!)
                    else -> circleBitmap(categoryColor(symbol.category), radiusDp = 7f, strokeDp = 2f)
                })
            }
            val point = LatLng(symbol.latitude, symbol.longitude)
            // The shared Figma pin has the same four-dp bottom offset as the MapLibre symbol layer.
            val anchorY = if (isPin) 1f - 4f / 43f else 0.5f
            val marker = markers[key]
            if (marker == null) {
                map.addMarker(MarkerOptions().position(point).icon(icon).anchor(0.5f, anchorY)
                    .flat(false).zIndex(10f))?.also { it.tag = key; markers[key] = it }
            } else {
                if (marker.position != point) marker.position = point
                marker.setIcon(icon)
                marker.setAnchor(0.5f, anchorY)
            }
        }
        // A long map session cannot retain an unbounded bitmap descriptor for every cluster count.
        if (descriptors.size > requiredIcons.size + 65) {
            descriptors.keys.filter { it.startsWith("cluster:") && it !in requiredIcons }.forEach(descriptors::remove)
        }
    }

    private fun drawLocation() {
        if (!active) return
        val fix = location
        if (fix == null) {
            accuracy?.remove(); accuracy = null
            dot?.remove(); dot = null
            cone?.remove(); cone = null
            return
        }
        val point = LatLng(fix.latitude, fix.longitude)
        val circle = accuracy
        if (circle == null) {
            accuracy = map.addCircle(CircleOptions().center(point).radius(fix.accuracyMeters.toDouble())
                .fillColor(0x1C6393F2).strokeColor(0x406393F2).strokeWidth(density).clickable(false).zIndex(0f))
        } else {
            circle.center = point
            circle.radius = fix.accuracyMeters.toDouble()
        }
        val icon = descriptors.getOrPut("location-dot") {
            BitmapDescriptorFactory.fromBitmap(circleBitmap(0xFF0C79FE.toInt(), radiusDp = 8f, strokeDp = 4f))
        }
        if (dot == null) {
            dot = map.addMarker(MarkerOptions().position(point).icon(icon).anchor(0.5f, 0.5f).flat(false).zIndex(30f))
        } else {
            dot?.position = point
            dot?.setIcon(icon)
        }
    }

    private fun drawHeading() {
        if (!active) return
        val fix = location
        val degrees = heading
        val bitmap = artwork?.heading
        if (fix == null || degrees == null || bitmap == null) {
            cone?.isVisible = false
            return
        }
        val icon = descriptors.getOrPut("location-heading") { BitmapDescriptorFactory.fromBitmap(bitmap) }
        val point = LatLng(fix.latitude, fix.longitude)
        val rotation = ((degrees - map.cameraPosition.bearing - HEADING_ARTWORK_BEARING) % 360.0 + 360.0).toFloat() % 360f
        if (cone == null) {
            cone = map.addMarker(MarkerOptions().position(point).icon(icon).anchor(0.5f, 0.5f)
                .flat(false).rotation(rotation).zIndex(20f))
        } else {
            cone?.apply { position = point; this.rotation = rotation; isVisible = true; setIcon(icon) }
        }
    }

    private fun circleBitmap(color: Int, radiusDp: Float, strokeDp: Float): Bitmap {
        val side = ((radiusDp + strokeDp) * 2 * density).roundToInt().coerceAtLeast(1)
        return Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888).apply {
            this.density = (160 * this@GooglePlaceRenderer.density).roundToInt()
            val canvas = Canvas(this)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            val center = side / 2f
            paint.color = Color.WHITE
            canvas.drawCircle(center, center, (radiusDp + strokeDp) * this@GooglePlaceRenderer.density, paint)
            paint.color = color
            canvas.drawCircle(center, center, radiusDp * this@GooglePlaceRenderer.density, paint)
        }
    }

    fun dispose() {
        if (disposed) return
        disposed = true
        // Parent/provider teardown can destroy its MapView before sibling effects are disposed.
        if (listening) {
            runCatching { map.setOnMarkerClickListener(null) }
            runCatching { map.setOnCameraMoveListener(null) }
            listening = false
        }
        markers.values.forEach { runCatching { it.remove() } }
        runCatching { accuracy?.remove() }
        runCatching { dot?.remove() }
        runCatching { cone?.remove() }
        markers.clear()
        descriptors.clear()
        symbols = emptyMap()
        accuracy = null; dot = null; cone = null
    }
}
