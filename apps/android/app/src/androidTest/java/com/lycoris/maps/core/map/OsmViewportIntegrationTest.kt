package com.lycoris.maps.core.map

import android.os.Bundle
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.lycoris.maps.BuildConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.maps.MapView
import org.maplibre.android.tile.TileOperation
import java.util.EnumSet
import kotlin.math.PI
import kotlin.math.asinh
import kotlin.math.floor
import kotlin.math.tan

/**
 * Opt in with -e lycorisOsmOnline true. Opens one ordinary viewport using the unmodified production
 * style, HTTP client, TLS validation and caches. Does not pan, zoom, clear caches or capture images.
 * This is resource/render/lifecycle evidence, not a replacement for visual acceptance.
 */
@RunWith(AndroidJUnit4::class)
class OsmViewportIntegrationTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun realOsmViewportRendersAndSurvivesBackgroundReturn() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue("Real OSM viewport test is opt-in", InstrumentationRegistry.getArguments()
            .getString("lycorisOsmOnline") == "true")
        assertTrue("Online instrumentation must run in the QA build", BuildConfig.TEST_ENVIRONMENT)
        assertTrue(instrumentation.targetContext.packageName.endsWith(".qa"))
        assertConnected()

        val state = NativeMapState()
        // Install listeners before starting any OSM request. Only the setup style is empty;
        // no result from this phase contributes to the assertions below.
        val style = mutableStateOf(LISTENER_SETUP_STYLE)
        compose.setContent { MapViewHost(Modifier.fillMaxSize(), state, style.value) }
        compose.waitUntil(10_000) { state.ready }

        val probe = OsmProbe(MapCamera())
        val tileListener = MapView.OnTileActionListener { operation, x, y, z, wrap, overscaledZ, sourceId ->
            probe.tile(operation, TileId(x, y, z, wrap, overscaledZ), sourceId)
        }
        val frameListener = MapView.OnDidFinishRenderingFrameWithStatsListener { fully, stats ->
            probe.frame(fully, stats.numDrawCalls)
        }
        val failureListener = MapView.OnDidFailLoadingMapListener { message -> probe.failed(message) }
        lateinit var mapView: MapView
        compose.runOnIdle {
            mapView = requireNotNull(compose.activity.window.decorView.findNativeMapView())
            assertTrue("MapView must have a visible, measured viewport", mapView.isShown && mapView.width > 0 && mapView.height > 0)
            mapView.addOnTileActionListener(tileListener)
            mapView.addOnDidFinishRenderingFrameListener(frameListener)
            mapView.addOnDidFailLoadingMapListener(failureListener)
        }

        try {
            compose.runOnIdle {
                probe.begin()
                style.value = MapStyles.osm
            }
            awaitOsmFrame(probe, returning = false, timeoutMs = 45_000)

            val originalMap = state.map
            var originalCamera: MapCamera? = null
            compose.runOnIdle {
                assertNotNull(originalMap)
                assertTrue(state.ready)
                assertTrue(originalMap!!.style!!.isFullyLoaded)
                assertNotNull(originalMap.style!!.getSource("osm"))
                assertNotNull(originalMap.style!!.getLayer("osm"))
                originalCamera = state.snapshotCamera()
            }

            compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
            // Advance the observation phase only after the production lifecycle has paused/stopped.
            // Resume must supply a new frame; an earlier fully-rendered frame cannot pass this check.
            instrumentation.runOnMainSync { probe.returning() }
            compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
            awaitOsmFrame(probe, returning = true, timeoutMs = 15_000)

            compose.runOnIdle {
                assertSame("Lifecycle return must preserve the mounted MapView", mapView,
                    compose.activity.window.decorView.findNativeMapView())
                assertSame("Lifecycle return must preserve the native map", originalMap, state.map)
                assertTrue(state.ready)
                assertTrue(state.map!!.style!!.isFullyLoaded)
                val before = requireNotNull(originalCamera)
                val after = state.snapshotCamera()
                assertEquals(before.latitude, after.latitude, 0.00001)
                assertEquals(before.longitude, after.longitude, 0.00001)
                assertEquals(before.zoom, after.zoom, 0.00001)
                assertEquals(before.bearing, after.bearing, 0.00001)
                assertEquals(before.tilt, after.tilt, 0.00001)
            }
            probe.assertHealthy()
            assertConnected()
            instrumentation.sendStatus(0, probe.result().apply {
                putString("lycorisOsmCameraRetained", "true")
                putString("lycorisOsmStyle", "MapStyles.osm")
            })
        } finally {
            instrumentation.runOnMainSync {
                probe.stop()
                mapView.removeOnTileActionListener(tileListener)
                mapView.removeOnDidFinishRenderingFrameListener(frameListener)
                mapView.removeOnDidFailLoadingMapListener(failureListener)
            }
        }
    }

    private fun assertConnected() {
        val manager = requireNotNull(InstrumentationRegistry.getInstrumentation().targetContext
            .getSystemService(ConnectivityManager::class.java))
        val network = manager.activeNetwork
        assertNotNull("Online OSM test cannot pass while the device is disconnected", network)
        assertTrue("Online OSM test requires an Internet-capable active network", manager
            .getNetworkCapabilities(requireNotNull(network))
            ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true)
        // This gate detects a disconnected device; it does not assert DNS/TLS/OSM reachability.
        // Tile errors remain failures, and cache-origin results never claim fresh network access.
    }

    private fun awaitOsmFrame(probe: OsmProbe, returning: Boolean, timeoutMs: Long) {
        try {
            compose.waitUntil(timeoutMs) {
                probe.assertHealthy()
                probe.hasFrame(returning)
            }
        } catch (failure: Throwable) {
            // No AssumptionViolatedException on timeout/network failure: explicit opt-in must fail.
            throw AssertionError("Real OSM viewport did not complete: ${probe.summary()}", failure)
        }
    }

    private fun View.findNativeMapView(): MapView? {
        if (this is MapView) return this
        if (this is ViewGroup) for (index in 0 until childCount) {
            getChildAt(index).findNativeMapView()?.let { return it }
        }
        return null
    }

    private data class TileId(val x: Int, val y: Int, val z: Int, val wrap: Int, val overscaledZ: Int) {
        fun coversCenter(camera: MapCamera): Boolean {
            if (z !in 0..19 || wrap != 0) return false
            val count = (1 shl z).toDouble()
            val centerX = floor((camera.longitude + 180.0) / 360.0 * count).toInt()
            val radians = camera.latitude * PI / 180.0
            val centerY = floor((1.0 - asinh(tan(radians)) / PI) / 2.0 * count).toInt()
            return x == centerX && y == centerY
        }
        override fun toString() = "$z/$x/$y@$overscaledZ"
    }

    private class OsmProbe(private val camera: MapCamera) {
        private var active = false
        private var returning = false
        private val actions = linkedMapOf<TileId, EnumSet<TileOperation>>()
        private val failures = mutableListOf<String>()
        private var frames = 0
        private var initialFrame = 0
        private var returnedFrame = 0
        private var centerProof: TileId? = null

        @Synchronized fun begin() { active = true }
        @Synchronized fun stop() { active = false }
        @Synchronized fun returning() { returning = true }

        @Synchronized fun tile(operation: TileOperation, id: TileId, sourceId: String) {
            if (!active || sourceId != "osm") return
            val seen = actions.getOrPut(id) { EnumSet.noneOf(TileOperation::class.java) }
            if (operation == TileOperation.EndParse &&
                (TileOperation.LoadFromNetwork in seen || TileOperation.LoadFromCache in seen) &&
                id.coversCenter(camera)) centerProof = id
            seen.add(operation)
            if (operation == TileOperation.Error) failures.add("OSM tile $id reported Error")
        }

        @Synchronized fun failed(message: String) {
            if (active) failures.add("Map loading failed: ${message.take(300)}")
        }

        @Synchronized fun frame(fully: Boolean, drawCalls: Int) {
            if (!active) return
            frames++
            // The production style contains the OSM raster and a neutral background. Requiring an actual draw
            // after fetched center-tile parsing rejects a background-only fully-loaded frame.
            // EndParse alone is insufficient: MapLibre can emit it for a null raster bucket.
            if (!fully || drawCalls <= 0 || centerProof == null || failures.isNotEmpty()) return
            if (returning) returnedFrame = frames else initialFrame = frames
        }

        @Synchronized fun assertHealthy() {
            assertFalse("OSM loading must not silently ignore failures: ${failures.joinToString()}", failures.isNotEmpty())
        }

        @Synchronized fun hasFrame(afterReturn: Boolean): Boolean =
            if (afterReturn) returnedFrame > initialFrame && initialFrame > 0 else initialFrame > 0

        @Synchronized fun summary(): String =
            "tiles=${actions.size}, center=$centerProof, frames=$frames, initial=$initialFrame, return=$returnedFrame, " +
                "network=${actions.values.count { TileOperation.LoadFromNetwork in it }}, " +
                "cache=${actions.values.count { TileOperation.LoadFromCache in it }}, failures=${failures.joinToString()}"

        @Synchronized fun result(): Bundle = Bundle().apply {
            putString("lycorisOsmViewportEvidence", summary())
            putString("lycorisOsmCenterTile", requireNotNull(centerProof).toString())
            putString("lycorisOsmCenterLoadEvents", actions.getValue(requireNotNull(centerProof))
                .filter { it == TileOperation.LoadFromNetwork || it == TileOperation.LoadFromCache }
                .joinToString { it.name })
            // These are the native MapLibre events, not HTTP cache/response diagnostics.
            // LoadFromNetwork may still be served by the unchanged production OkHttp cache.
            putString("lycorisOsmLoadOriginScope", "MapLibre tile-loader events; HTTP cache is unchanged")
            putString("lycorisOsmInitialFullyRendered", initialFrame.toString())
            putString("lycorisOsmReturnFullyRendered", returnedFrame.toString())
        }
    }

    private companion object {
        const val LISTENER_SETUP_STYLE = """{"version":8,"sources":{},"layers":[]}"""
    }
}
