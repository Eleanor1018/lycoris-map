package com.lycoris.maps.core.map

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.maplibre.android.RenderingEngine
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap

/** Exercises the real native MapView with an offline style, without tile/backend dependencies. */
class MapLifecycleTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun backgroundReturnAndPanelRecompositionRetainNativeMapAndCamera() {
        val state = NativeMapState()
        val panelRevision = mutableIntStateOf(0)
        compose.setContent {
            Box(Modifier.fillMaxSize()) {
                MapViewHost(Modifier.fillMaxSize(), state, OFFLINE_STYLE)
                Text("Panel revision ${panelRevision.intValue}")
            }
        }
        compose.waitUntil(10_000) { state.ready }
        var original: MapLibreMap? = null
        compose.runOnIdle {
            assertEquals(
                "The native map must use OpenGL ES so devices without Vulkan remain supported",
                RenderingEngine.Type.OPENGL,
                RenderingEngine.getCurrentType(),
            )
            original = state.map
            original!!.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder()
                .target(LatLng(31.2304, 121.4737)).zoom(15.0).bearing(37.0).build()))
        }
        repeat(2) { revision ->
            compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
            compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
            compose.runOnIdle { panelRevision.intValue = revision + 1 }
            compose.waitForIdle()
            compose.runOnIdle {
                assertTrue(state.ready)
                assertSame("Panel/lifecycle changes must retain the mounted native renderer", original, state.map)
                assertTrue(state.map!!.style!!.isFullyLoaded)
                val camera = state.map!!.cameraPosition
                assertEquals(31.2304, camera.target!!.latitude, 0.00001)
                assertEquals(121.4737, camera.target!!.longitude, 0.00001)
                assertEquals(15.0, camera.zoom, 0.00001)
                assertEquals(37.0, camera.bearing, 0.00001)
            }
        }
    }

    private companion object {
        const val OFFLINE_STYLE = """{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#f5f1f7"}}]}"""
    }
}
