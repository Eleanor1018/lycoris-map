package com.lycoris.maps.core.map

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
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
import com.lycoris.maps.core.device.DeviceLocation
import com.lycoris.maps.core.device.HeadingState
import com.lycoris.maps.core.model.Marker
import com.lycoris.maps.core.model.PlaceCategory
import com.lycoris.maps.core.model.validCoordinate
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.size.Precision
import coil3.svg.SvgDecoder
import coil3.toBitmap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression.eq
import org.maplibre.android.style.expressions.Expression.exponential
import org.maplibre.android.style.expressions.Expression.get
import org.maplibre.android.style.expressions.Expression.interpolate
import org.maplibre.android.style.expressions.Expression.literal
import org.maplibre.android.style.expressions.Expression.stop
import org.maplibre.android.style.expressions.Expression.zoom
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.*
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt

/** Native sources/symbol layers stay mounted while panels, searches and location state change. */
@Composable
fun PlaceLayers(
    state: NativeMapState,
    places: List<Marker>,
    onSelect: (Long) -> Unit,
    location: DeviceLocation? = null,
    heading: HeadingState? = null,
) {
    val context = LocalContext.current
    val density = LocalDensity.current.density
    val selected by rememberUpdatedState(onSelect)
    val map = state.map
    val ready = state.ready
    val band = PlaceClustering.zoomBand(state.camera.zoom)
    val bitmaps by produceState<PlaceBitmaps?>(null, context, density) {
        value = try {
            PlaceBitmaps.load(context)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            // A native colored dot remains visible if an app asset fails to decode.
            Log.e("LycorisMap", "Bundled Figma map artwork could not be decoded", error)
            null
        }
    }
    val renderer = remember(map, density) { map?.let { PlaceRenderer(state, it, density) { id -> selected(id) } } }

    DisposableEffect(renderer) {
        renderer?.listen()
        onDispose { renderer?.dispose() }
    }
    LaunchedEffect(renderer, ready, bitmaps) {
        withContext(Dispatchers.Main.immediate) {
            if (ready) renderer?.attach(bitmaps) else renderer?.invalidateStyle()
        }
    }
    LaunchedEffect(renderer, ready, places, band) {
        if (renderer != null && ready) {
            val (symbols, features) = withContext(Dispatchers.Default) {
                val clustered = PlaceClustering.cluster(places, band.toDouble())
                clustered to placeFeatures(clustered)
            }
            // Compose's test dispatcher may resume this effect on a worker after Default.
            // MapLibre sources and style operations require the Android main thread explicitly.
            withContext(Dispatchers.Main.immediate) { renderer.updatePlaces(symbols, features) }
        }
    }
    LaunchedEffect(renderer, ready, location) {
        val now = SystemClock.elapsedRealtimeNanos()
        val valid = location?.takeIf { validCoordinate(it.latitude, it.longitude) &&
            it.accuracyMeters.isFinite() && it.accuracyMeters > 0f && it.elapsedRealtimeNanos in 1..now &&
            it.ageMillis(now) <= LOCATION_MAX_AGE_MS }
        withContext(Dispatchers.Main.immediate) { renderer?.updateLocation(valid) }
        if (valid != null) {
            delay((LOCATION_MAX_AGE_MS - valid.ageMillis(now) + 1).coerceAtLeast(1))
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

private const val LOCATION_MAX_AGE_MS = 60_000L
private const val PLACE_SOURCE = "lycoris-places"
private const val LOCATION_SOURCE = "lycoris-device-location"
private const val PIN_LAYER = "lycoris-place-pins"
private const val FALLBACK_LAYER = "lycoris-place-fallback"
private const val CLUSTER_LAYER = "lycoris-place-clusters"
private const val ACCURACY_LAYER = "lycoris-location-accuracy"
private const val HEADING_LAYER = "lycoris-location-heading"
private const val DOT_LAYER = "lycoris-location-dot"
private const val HEADING_IMAGE = "lycoris-heading-artwork"
/** Figma's exported half-cone has this fixed artwork bearing; its source bytes remain untouched. */
internal const val HEADING_ARTWORK_BEARING = 163.11334
private val EMPTY_FEATURES: FeatureCollection = FeatureCollection.fromFeatures(emptyList())
private val OWN_LAYERS = listOf(DOT_LAYER, HEADING_LAYER, CLUSTER_LAYER, PIN_LAYER, FALLBACK_LAYER, ACCURACY_LAYER)

private class PlaceRenderer(
    private val state: NativeMapState,
    private val map: MapLibreMap,
    private val density: Float,
    private val onSelect: (Long) -> Unit,
) {
    private var disposed = false
    private var style: Style? = null
    private var artwork: PlaceBitmaps? = null
    private var symbols = emptyList<PlaceSymbol>()
    private var symbolsByKey = emptyMap<String, PlaceSymbol>()
    private var features = EMPTY_FEATURES
    private var location: DeviceLocation? = null
    private var heading: Double? = null
    private val imageNames = LinkedHashSet<String>()

    private val click = MapLibreMap.OnMapClickListener { point ->
        if (disposed || !state.ready || state.map !== map || style !== map.style) return@OnMapClickListener false
        val pixel = map.projection.toScreenLocation(point)
        val reach = 24f * density
        val found = try {
            map.queryRenderedFeatures(RectF(pixel.x - reach, pixel.y - reach, pixel.x + reach, pixel.y + reach),
                PIN_LAYER, CLUSTER_LAYER, FALLBACK_LAYER)
        } catch (_: IllegalStateException) {
            return@OnMapClickListener false
        }
        val selected = found.asSequence()
            .filter { it.hasProperty("symbolKey") }
            .mapNotNull { symbolsByKey[it.getStringProperty("symbolKey")] }
            .distinctBy { it.key }
            .minWithOrNull(compareBy<PlaceSymbol> {
                val center = map.projection.toScreenLocation(LatLng(it.latitude, it.longitude))
                val dy = center.y - pixel.y - if (it.clustered) 0f else 25.5f * density
                val dx = center.x - pixel.x
                dx * dx + dy * dy
            }.thenBy { it.memberIds.first() }) ?: return@OnMapClickListener false
        if (selected.clustered) {
            state.moveTo(selected.latitude, selected.longitude, min(map.cameraPosition.zoom + 2.0, 20.0))
        } else {
            onSelect(selected.memberIds.single())
        }
        true
    }

    fun listen() { map.addOnMapClickListener(click) }

    fun attach(bitmaps: PlaceBitmaps?) {
        if (disposed || !state.ready || state.map !== map) return
        val next = map.style?.takeIf { it.isFullyLoaded } ?: return
        artwork = bitmaps
        if (style !== next) {
            style = next
            imageNames.clear()
            // A temporarily suspended composition can return to the same style. Remove only our
            // reserved resources before reattaching, rather than adding duplicate native sources.
            OWN_LAYERS.forEach { if (next.getLayer(it) != null) next.removeLayer(it) }
            listOf(LOCATION_SOURCE, PLACE_SOURCE).forEach { if (next.getSource(it) != null) next.removeSource(it) }
            next.addSource(GeoJsonSource(PLACE_SOURCE, EMPTY_FEATURES))
            next.addSource(GeoJsonSource(LOCATION_SOURCE, EMPTY_FEATURES))
            next.addLayer(CircleLayer(ACCURACY_LAYER, LOCATION_SOURCE).withProperties(
                circleColor(0xFF6393F2.toInt()), circleOpacity(0.11f), circleStrokeColor(0xFF6393F2.toInt()),
                circleStrokeWidth(1f), circleStrokeOpacity(0.25f),
                circlePitchAlignment(Property.CIRCLE_PITCH_ALIGNMENT_MAP),
            ))
            next.addLayer(CircleLayer(FALLBACK_LAYER, PLACE_SOURCE).withFilter(eq(get("kind"), literal("pin")))
                .withProperties(circleRadius(7f), circleColor(get("color")), circleStrokeColor(Color.WHITE), circleStrokeWidth(2f)))
            next.addLayer(SymbolLayer(PIN_LAYER, PLACE_SOURCE).withFilter(eq(get("kind"), literal("pin")))
                .withProperties(iconImage(get("image")), iconAnchor(Property.ICON_ANCHOR_BOTTOM),
                    iconOffset(arrayOf(0f, 4f)), iconAllowOverlap(true), iconIgnorePlacement(true),
                    iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_VIEWPORT), iconPitchAlignment(Property.ICON_PITCH_ALIGNMENT_VIEWPORT)))
            next.addLayer(SymbolLayer(CLUSTER_LAYER, PLACE_SOURCE).withFilter(eq(get("kind"), literal("cluster")))
                .withProperties(iconImage(get("image")), iconAllowOverlap(true), iconIgnorePlacement(true),
                    iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_VIEWPORT), iconPitchAlignment(Property.ICON_PITCH_ALIGNMENT_VIEWPORT)))
            next.addLayer(SymbolLayer(HEADING_LAYER, LOCATION_SOURCE).withProperties(
                iconImage(HEADING_IMAGE), iconAllowOverlap(true), iconIgnorePlacement(true),
                // Native map alignment subtracts camera bearing continuously, without Compose frames.
                iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_MAP), iconPitchAlignment(Property.ICON_PITCH_ALIGNMENT_VIEWPORT),
                visibility(Property.NONE),
            ))
            next.addLayer(CircleLayer(DOT_LAYER, LOCATION_SOURCE).withProperties(
                circleRadius(8f), circleColor(0xFF0C79FE.toInt()), circleStrokeColor(Color.WHITE), circleStrokeWidth(4f),
            ))
        }
        withStyle { active ->
            bitmaps?.pins?.forEach { (category, bitmap) -> addImage(active, pinImage(category), bitmap) }
            bitmaps?.heading?.let { addImage(active, HEADING_IMAGE, it) }
            active.getLayer(FALLBACK_LAYER)?.setProperties(visibility(if (bitmaps == null) Property.VISIBLE else Property.NONE))
            active.getLayer(PIN_LAYER)?.setProperties(visibility(if (bitmaps == null) Property.NONE else Property.VISIBLE))
        }
        drawPlaces()
        drawLocation()
        drawHeading()
    }

    fun invalidateStyle() {
        // The old style is already being destroyed by MapLibre; never call its detached native sources.
        style = null
        imageNames.clear()
    }

    fun updatePlaces(value: List<PlaceSymbol>, renderedFeatures: FeatureCollection) {
        if (disposed) return
        symbols = value
        symbolsByKey = value.associateBy { it.key }
        features = renderedFeatures
        drawPlaces()
    }

    fun updateLocation(value: DeviceLocation?) {
        if (disposed) return
        location = value
        drawLocation()
        drawHeading()
    }

    fun updateHeading(degrees: Double?) {
        if (disposed) return
        heading = degrees
        drawHeading()
    }

    private fun drawPlaces() = withStyle { active ->
        val requiredImages = HashSet<String>()
        symbols.forEach { symbol ->
            if (symbol.clustered) {
                val key = symbol.imageKey()
                requiredImages.add(key)
                if (key !in imageNames) addImage(active, key, clusterBitmap(symbol.count, symbol.category, density))
            }
        }
        active.getSourceAs<GeoJsonSource>(PLACE_SOURCE)?.setGeoJson(features)
        // Bound sprite growth during long zoom sessions; keep one recently unused generation to avoid flashing.
        if (imageNames.size > requiredImages.size + PlaceCategory.entries.size + 65) {
            imageNames.filter { it.startsWith("lycoris-cluster-") && it !in requiredImages }.forEach {
                active.removeImage(it)
                imageNames.remove(it)
            }
        }
    }

    private fun drawLocation() = withStyle { active ->
        val fix = location
        val features = if (fix == null) EMPTY_FEATURES else FeatureCollection.fromFeatures(listOf(
            Feature.fromGeometry(Point.fromLngLat(fix.longitude, fix.latitude)),
        ))
        active.getSourceAs<GeoJsonSource>(LOCATION_SOURCE)?.setGeoJson(features)
        if (fix != null) {
            val cosine = cos(Math.toRadians(fix.latitude.coerceIn(-85.05112878, 85.05112878)))
            val radiusAtZero = fix.accuracyMeters * 512.0 / (40_075_016.6856 * cosine)
            active.getLayer(ACCURACY_LAYER)?.setProperties(circleRadius(interpolate(exponential(2.0), zoom(),
                stop(0.0, radiusAtZero), stop(22.0, radiusAtZero * 4_194_304.0))))
        }
    }

    private fun drawHeading() = withStyle { active ->
        val degrees = heading
        val visible = location != null && degrees != null && artwork?.heading != null
        active.getLayer(HEADING_LAYER)?.setProperties(
            visibility(if (visible) Property.VISIBLE else Property.NONE),
            iconRotate(((degrees ?: 0.0) - HEADING_ARTWORK_BEARING).toFloat()),
        )
    }

    private inline fun withStyle(action: (Style) -> Unit) {
        val active = style ?: return
        if (disposed || state.map !== map || !state.ready || !active.isFullyLoaded || map.style !== active) return
        try { action(active) } catch (_: IllegalStateException) { invalidateStyle() }
    }

    private fun addImage(active: Style, name: String, bitmap: Bitmap) {
        if (imageNames.add(name)) active.addImage(name, bitmap)
    }

    fun dispose() {
        if (disposed) return
        map.removeOnMapClickListener(click)
        withStyle { active ->
            OWN_LAYERS.forEach { active.removeLayer(it) }
            active.removeSource(LOCATION_SOURCE)
            active.removeSource(PLACE_SOURCE)
            imageNames.forEach(active::removeImage)
        }
        disposed = true
        style = null
        symbols = emptyList()
        symbolsByKey = emptyMap()
        features = EMPTY_FEATURES
        imageNames.clear()
    }
}

internal class PlaceBitmaps(val pins: Map<PlaceCategory, Bitmap>, val heading: Bitmap?) {
    companion object {
        suspend fun load(context: Context): PlaceBitmaps {
            val density = context.resources.displayMetrics.density
            val dpi = context.resources.displayMetrics.densityDpi
            suspend fun decode(name: String, width: Int, height: Int): Bitmap? {
                val w = (width * density).roundToInt().coerceAtLeast(1)
                val h = (height * density).roundToInt().coerceAtLeast(1)
                val result = SingletonImageLoader.get(context).execute(ImageRequest.Builder(context)
                    .data("file:///android_asset/figma/$name.svg").decoderFactory(SvgDecoder.Factory())
                    .size(w, h).precision(Precision.EXACT).allowHardware(false).build())
                return (result as? SuccessResult)?.image?.toBitmap(w, h)?.apply { this.density = dpi }
            }
            val original = checkNotNull(decode("place_pin", 27, 43)) { "Missing bundled Figma place pin" }
            val cone = decode("location_heading", 86, 88)
            return withContext(Dispatchers.Default) {
                val pins = PlaceCategory.entries.associateWith { category ->
                    if (category == PlaceCategory.ACCESSIBLE_TOILET) original else tintPin(original, categoryColor(category))
                }
                // The SVG's last 2 rows are transparent; crop that padding so its (43,43) dot rotates around the coordinate.
                val centered = cone?.let { Bitmap.createBitmap(it, 0, 0, it.width, min(it.width, it.height)).apply { this.density = dpi } }
                PlaceBitmaps(pins, centered)
            }
        }
    }
}

/** Native category tint changes only the blue component; white rim, black center and shadow remain intact. */
private fun tintPin(original: Bitmap, tint: Int): Bitmap {
    val pixels = IntArray(original.width * original.height)
    original.getPixels(pixels, 0, original.width, 0, 0, original.width, original.height)
    pixels.indices.forEach { index ->
        val pixel = pixels[index]
        val red = Color.red(pixel)
        val blue = Color.blue(pixel)
        if (blue > red && blue > Color.green(pixel)) {
            val fraction = ((blue - red) / 143.0).coerceIn(0.0, 1.0)
            val neutral = red - fraction * 99.0
            fun channel(value: Int) = (neutral + fraction * value).roundToInt().coerceIn(0, 255)
            pixels[index] = Color.argb(Color.alpha(pixel), channel(Color.red(tint)), channel(Color.green(tint)), channel(Color.blue(tint)))
        }
    }
    return Bitmap.createBitmap(pixels, original.width, original.height, Bitmap.Config.ARGB_8888).apply { density = original.density }
}

private fun pinImage(category: PlaceCategory) = "lycoris-pin-${category.wireValue}"
private fun PlaceSymbol.imageKey() = if (clustered) "lycoris-cluster-${category?.wireValue ?: "mixed"}-$count" else pinImage(category!!)
private fun placeFeatures(symbols: List<PlaceSymbol>): FeatureCollection = FeatureCollection.fromFeatures(symbols.map { symbol ->
    Feature.fromGeometry(Point.fromLngLat(symbol.longitude, symbol.latitude), null, symbol.key).apply {
        addStringProperty("symbolKey", symbol.key)
        addStringProperty("kind", if (symbol.clustered) "cluster" else "pin")
        addStringProperty("image", symbol.imageKey())
        addStringProperty("color", colorHex(symbol.category))
        // IDs intentionally stay strings across GeoJSON/native JSON; Long precision is preserved.
        if (!symbol.clustered) addStringProperty("placeId", symbol.memberIds.single().toString())
    }
})
internal fun categoryColor(category: PlaceCategory?): Int = when (category) {
    PlaceCategory.ACCESSIBLE_TOILET -> 0xFF6393F2.toInt()
    PlaceCategory.BABY_ROOM -> 0xFFFEA90C.toInt()
    PlaceCategory.FRIENDLY_CLINIC -> 0xFF1FBC00.toInt()
    PlaceCategory.OTHER -> 0xFF6750A4.toInt()
    null -> 0xFF625B71.toInt()
}
private fun colorHex(category: PlaceCategory?) = "#%06X".format(categoryColor(category) and 0xFFFFFF)

/** System-font count on a native circle avoids a network glyph server or fabricated design asset. */
internal fun clusterBitmap(count: Int, category: PlaceCategory?, density: Float): Bitmap {
    val side = (48 * density).roundToInt()
    val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888).apply { this.density = (160 * density).roundToInt() }
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val center = side / 2f
    paint.color = Color.WHITE
    canvas.drawCircle(center, center, 22 * density, paint)
    paint.color = categoryColor(category)
    canvas.drawCircle(center, center, 20 * density, paint)
    paint.color = if (category == null || category == PlaceCategory.OTHER) Color.WHITE else 0xFF1D1B20.toInt()
    paint.typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    paint.textSize = 14 * density
    paint.textAlign = Paint.Align.CENTER
    val label = count.toString()
    if (paint.measureText(label) > 32 * density) paint.textSize *= 32 * density / paint.measureText(label)
    canvas.drawText(label, center, center - (paint.ascent() + paint.descent()) / 2, paint)
    return bitmap
}
