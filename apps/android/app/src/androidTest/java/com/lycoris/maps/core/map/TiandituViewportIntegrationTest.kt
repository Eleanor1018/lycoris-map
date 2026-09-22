package com.lycoris.maps.core.map

import android.graphics.RectF
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import com.lycoris.maps.BuildConfig
import com.lycoris.maps.core.data.preferences.MapSource
import com.lycoris.maps.core.device.DeviceLocation
import com.lycoris.maps.core.model.Marker
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapView
import org.maplibre.android.tile.TileOperation
import org.maplibre.geojson.Point
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.*

/** Opt-in, read-only native WMTS viewport check; no account/backend writes or device GPS changes. */
class TiandituViewportIntegrationTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun baseLabelsOverlaysAndCameraSurviveBackgroundAndProviderSwitches() {
        assumeTrue("Online Tianditu check is opt-in", InstrumentationRegistry.getArguments()
            .getString("lycorisTiandituOnline") == "true")
        assertTrue(BuildConfig.TEST_ENVIRONMENT)
        assertTrue(InstrumentationRegistry.getInstrumentation().targetContext.packageName.endsWith(".qa"))
        assertTrue("Opt-in Tianditu verification requires a key", BuildConfig.TIANDITU_MAPS_CONFIGURED)
        val state = NativeMapState()
        val provider = mutableStateOf(MapSource.TIANDITU)
        val style = mutableStateOf(EMPTY_STYLE)
        val fix = mutableStateOf<DeviceLocation?>(null)
        val loaded = AtomicInteger()
        var selected: Long? = null
        val marker = Marker(900001, 31.2304, 121.4737, "baby_room", "Synthetic Tianditu marker")
        compose.setContent {
            key(provider.value) {
                MapViewHost(Modifier.fillMaxSize(), state, style.value,
                    rasterSourceIds = sources(provider.value), onTilesLoaded = { loaded.incrementAndGet() })
                PlaceLayers(state, listOf(marker), { selected = it }, fix.value)
            }
        }
        val evidence = mutableListOf<String>()
        var active: ViewportProbe? = null
        try {
            for ((index, source) in listOf(MapSource.TIANDITU, MapSource.OSM, MapSource.TIANDITU).withIndex()) {
                val oldMap = state.map
                var expected = MapCamera()
                active?.detach()
                compose.runOnIdle {
                    expected = state.snapshotCamera()
                    state.camera = expected
                    style.value = EMPTY_STYLE
                    provider.value = source
                }
                compose.waitUntil(10_000) { state.ready && state.map != null && (index == 0 || state.map !== oldMap) }
                lateinit var view: MapView
                compose.runOnIdle { view = requireNotNull(compose.activity.window.decorView.findMapView()) }
                val probe = ViewportProbe(view, sources(source), expected)
                active = probe
                val previouslyLoaded = loaded.get()
                compose.runOnIdle {
                    probe.attach()
                    style.value = if (source == MapSource.TIANDITU) MapStyles.tianditu(BuildConfig.TIANDITU_MAPS_API_KEY) else MapStyles.osm
                }
                compose.waitUntil(45_000) { probe.assertHealthy(); probe.complete() && loaded.get() > previouslyLoaded }
                compose.runOnIdle {
                    assertCamera(expected, state.snapshotCamera())
                    assertTrue(state.ready)
                    assertTrue(state.map!!.style!!.isFullyLoaded)
                    sources(source).forEach { assertNotNull(state.map!!.style!!.getSource(it)) }
                    fix.value = DeviceLocation(31.232, 121.476, 8f, null, System.currentTimeMillis(), SystemClock.elapsedRealtimeNanos(), false)
                }
                var overlayDiagnostic = "No overlay frame observed"
                try { compose.waitUntil(5_000) {
                    var visible = false
                    compose.runOnUiThread {
                        val map = state.map!!
                        val pins = map.queryRenderedFeatures(RectF(0f, 0f, view.width.toFloat(), view.height.toFloat()),
                            "lycoris-place-pins", "lycoris-place-fallback")
                        val pin = pins.any { (it.geometry() as? Point)?.let { point ->
                            abs(point.latitude() - marker.lat) < 0.00001 && abs(point.longitude() - marker.lng) < 0.00001
                        } == true }
                        val dot = map.projection.toScreenLocation(LatLng(31.232, 121.476))
                        val dots = map.queryRenderedFeatures(dot, "lycoris-location-dot")
                        overlayDiagnostic = "source=$source, ready=${state.ready}, pins=${pins.map { it.toJson() }}, dots=${dots.size}, layers=${map.style?.layers?.map { it.id }}"
                        visible = pin && dots.isNotEmpty()
                    }
                    visible
                } } catch (failure: Throwable) { throw AssertionError(overlayDiagnostic, failure) }
                if (index == 0) {
                    var tap = Offset.Zero
                    compose.runOnIdle {
                        val pixel = state.map!!.projection.toScreenLocation(LatLng(marker.lat, marker.lng))
                        tap = Offset(pixel.x, pixel.y - 10 * compose.activity.resources.displayMetrics.density)
                    }
                    compose.onRoot().performTouchInput { click(tap) }
                    compose.waitUntil(5_000) { selected == marker.id }
                    val mounted = state.map
                    compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
                    val frameBefore = probe.frameCount()
                    compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
                    compose.waitUntil(15_000) { probe.assertHealthy(); probe.frameCount() > frameBefore }
                    compose.runOnIdle {
                        assertSame(mounted, state.map)
                        assertCamera(expected, state.snapshotCamera())
                    }
                }
                evidence += "${source.name}: ${probe.summary()}"
            }
            InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply {
                putString("lycorisTiandituEvidence", evidence.joinToString("; "))
                putString("lycorisTiandituOverlays", "WGS84 marker and synthetic location rendered; marker click selected its ID")
                putString("lycorisTiandituLifecycle", "background frame recovered; Tianditu/OSM/Tianditu camera retained")
            })
        } finally { active?.detach() }
    }

    private fun assertCamera(expected: MapCamera, actual: MapCamera) {
        assertEquals(expected.latitude, actual.latitude, 0.00001)
        assertEquals(expected.longitude, actual.longitude, 0.00001)
        assertEquals(expected.zoom, actual.zoom, 0.00001)
        assertEquals(expected.bearing, actual.bearing, 0.00001)
        assertEquals(expected.tilt, actual.tilt, 0.00001)
    }

    private fun sources(source: MapSource) = if (source == MapSource.TIANDITU) MapStyles.tiandituSources else MapStyles.osmSources
    private fun View.findMapView(): MapView? {
        if (this is MapView) return this
        if (this is ViewGroup) for (i in 0 until childCount) getChildAt(i).findMapView()?.let { return it }
        return null
    }

    private class ViewportProbe(private val view: MapView, private val sources: Set<String>, private val camera: MapCamera) {
        private val fetched = mutableSetOf<List<String>>()
        private val centerParsed = mutableSetOf<String>()
        private val errors = mutableSetOf<String>()
        private var renderedFrames = 0
        private val tiles = MapView.OnTileActionListener { operation, x, y, z, wrap, over, source ->
            synchronized(this) {
                if (source in sources) {
                    val id = listOf(source, "$x", "$y", "$z", "$wrap", "$over")
                    when (operation) {
                        TileOperation.LoadFromNetwork, TileOperation.LoadFromCache -> fetched.add(id)
                        TileOperation.EndParse -> {
                            val count = 2.0.pow(z)
                            val cx = floor((camera.longitude + 180) / 360 * count).toInt()
                            val cy = floor((1 - asinh(tan(camera.latitude * PI / 180)) / PI) / 2 * count).toInt()
                            if (id in fetched && x == cx && y == cy && wrap == 0) centerParsed.add(source)
                        }
                        TileOperation.Error -> errors.add("$source tile $z/$x/$y")
                        else -> Unit
                    }
                }
            }
        }
        private val frames = MapView.OnDidFinishRenderingFrameWithStatsListener { fully, stats ->
            synchronized(this) { if (fully && stats.numDrawCalls > 0 && centerParsed.containsAll(sources)) renderedFrames++ }
        }
        fun attach() { view.addOnTileActionListener(tiles); view.addOnDidFinishRenderingFrameListener(frames) }
        fun detach() { InstrumentationRegistry.getInstrumentation().runOnMainSync {
            view.removeOnTileActionListener(tiles); view.removeOnDidFinishRenderingFrameListener(frames)
        } }
        @Synchronized fun complete() = renderedFrames > 0 && centerParsed.containsAll(sources)
        @Synchronized fun frameCount() = renderedFrames
        @Synchronized fun assertHealthy() { assertTrue("Tile errors: $errors", errors.isEmpty()) }
        @Synchronized fun summary() = "center sources=$centerParsed, rendered frames=$renderedFrames, tile-loader fetch/cache events=${fetched.size}"
    }

    private companion object { const val EMPTY_STYLE = """{"version":8,"sources":{},"layers":[]}""" }
}
