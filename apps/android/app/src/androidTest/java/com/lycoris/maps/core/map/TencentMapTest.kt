package com.lycoris.maps.core.map

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import com.lycoris.maps.BuildConfig
import com.lycoris.maps.core.model.Marker
import com.tencent.tencentmap.mapsdk.maps.model.LatLng
import com.tencent.tencentmap.mapsdk.maps.model.LatLngBounds
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.pow

class TencentMapTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private fun coordinates() = requireNotNull(TencentCoordinates.load(InstrumentationRegistry.getInstrumentation().targetContext))

    @Test fun geographicCameraAndScaleSurviveRepeatedProviderSwitches() {
        val converter = coordinates()
        val original = MapCamera(31.2304, 121.4737, 13.25, 37.0, 42.0)
        var current = original
        repeat(20) {
            val rendered = converter.camera(current)
            assertTrue(rendered.target.longitude > original.longitude)
            assertEquals(512.0 * 2.0.pow(current.zoom), 256.0 * 2.0.pow(rendered.zoom.toDouble()), 0.001)
            current = requireNotNull(converter.camera(rendered))
        }
        assertEquals(original.latitude, current.latitude, 0.0000001)
        assertEquals(original.longitude, current.longitude, 0.0000001)
        assertEquals(original.zoom, current.zoom, 0.00001)
        assertEquals(original.bearing, current.bearing, 0.00001)
        assertEquals(original.tilt, current.tilt, 0.00001)
    }

    @Test fun mainlandPickingUsesWgs84WhileOverseasCoordinatesStayUnchanged() {
        val converter = coordinates()
        val locations = listOf(40.124 to 124.394, 31.2304 to 121.4737, 22.3193 to 114.1694,
            25.0330 to 121.5654, 35.6762 to 139.6503)
        for ((lat, lng) in locations) {
            val point = converter.toMap(lat, lng)
            val restored = requireNotNull(converter.fromMap(point))
            assertEquals(lat, restored.latitude, 0.0000001)
            assertEquals(lng, restored.longitude, 0.0000001)
        }
        assertEquals(LatLng(35.6762, 139.6503), converter.toMap(35.6762, 139.6503))
        val envelope = converter.queryBounds(LatLngBounds(LatLng(31.22, 121.46), LatLng(31.24, 121.49)))
        assertTrue(envelope.south < 31.22 && envelope.north > 31.24)
        assertTrue(envelope.west < 121.46 && envelope.east > 121.49)
    }

    /** Real SDK and key, ordinary synthetic Shanghai viewport; no account/API writes or device fix. */
    @Test fun authenticatedTencentViewportSurvivesBackgroundAndSwitchesBackToOsm() {
        assumeTrue("Tencent online check is opt-in", InstrumentationRegistry.getArguments().getString("lycorisTencentOnline") == "true")
        assertTrue(BuildConfig.TEST_ENVIRONMENT)
        assertTrue("Configure an Android Tencent SDK key", BuildConfig.TENCENT_MAPS_CONFIGURED)
        val state = NativeMapState()
        val tencent = mutableStateOf(true)
        val authorized = AtomicBoolean(false)
        val loaded = AtomicBoolean(false)
        val failed = AtomicBoolean(false)
        compose.setContent {
            Box(Modifier.fillMaxSize()) {
                if (tencent.value) {
                    TencentMapViewHost(Modifier.fillMaxSize(), state,
                        onAuthorized = { authorized.set(true) }, onTilesLoaded = { loaded.set(true) },
                        onUnavailable = { failed.set(true) })
                    TencentPlaceLayers(state, listOf(Marker(1, 31.2304, 121.4737, "baby_room", "Synthetic map test")), {})
                } else MapViewHost(Modifier.fillMaxSize(), state,
                    styleJson = """{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#f5f1f7"}}]}""")
            }
        }
        compose.waitUntil(45_000) { failed.get() || (authorized.get() && loaded.get() && state.ready) }
        assertFalse("Tencent SDK authentication or initialization failed", failed.get())
        compose.waitUntil(10_000) {
            var visible = false
            compose.runOnUiThread { visible = state.tencentMap?.screenMarkers?.any { it.tag is String } == true }
            visible
        }
        compose.runOnIdle {
            val marker = state.tencentMap!!.screenMarkers.first { it.tag is String }
            val geographic = requireNotNull(state.tencentCoordinates!!.fromMap(marker.position))
            assertEquals(31.2304, geographic.latitude, 0.0000001)
            assertEquals(121.4737, geographic.longitude, 0.0000001)
            assertFalse(marker.isInfoWindowEnable)
        }
        val original = state.tencentMap
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.runOnIdle {
            assertSame(original, state.tencentMap)
            val camera = state.snapshotCamera()
            assertEquals(31.2304, camera.latitude, 0.0001)
            assertEquals(121.4737, camera.longitude, 0.0001)
            state.camera = camera
            tencent.value = false
        }
        compose.waitUntil(10_000) { state.map != null && state.tencentMap == null && state.ready }
        compose.runOnIdle {
            val camera = state.snapshotCamera()
            assertEquals(31.2304, camera.latitude, 0.0001)
            assertEquals(121.4737, camera.longitude, 0.0001)
            loaded.set(false)
            tencent.value = true
        }
        compose.waitUntil(30_000) { failed.get() || (state.tencentMap != null && state.map == null && state.ready && loaded.get()) }
        assertFalse(failed.get())
        compose.runOnIdle {
            assertNotSame(original, state.tencentMap)
            val camera = state.snapshotCamera()
            assertEquals(31.2304, camera.latitude, 0.0001)
            assertEquals(121.4737, camera.longitude, 0.0001)
            assertEquals(13.0, camera.zoom, 0.0001)
        }
    }
}
