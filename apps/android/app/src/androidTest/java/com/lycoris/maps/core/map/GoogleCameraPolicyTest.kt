package com.lycoris.maps.core.map

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.pow

/** SDK value objects only: no key, Google service, MapView or network is needed for these checks. */
class GoogleCameraPolicyTest {
    @Test fun providerRoundTripPreservesGeographicCameraAndWorldScale() {
        val original = MapCamera(31.2304, 121.4737, 13.25, 37.0, 42.0)
        val google = original.toGoogleCameraPosition()
        assertEquals(512.0 * 2.0.pow(original.zoom), 256.0 * 2.0.pow(google.zoom.toDouble()), 0.001)
        assertCamera(original, google.toNativeCamera())
    }

    @Test fun repeatedProviderSwitchesDoNotAccumulateAOneLevelZoomDrift() {
        val original = MapCamera(40.12345, -179.95, 9.625, 359.0, 15.0)
        var current = original
        repeat(20) { current = current.toGoogleCameraPosition().toNativeCamera() }
        assertCamera(original, current)
    }

    @Test fun googleZoomLimitsAreAppliedAfterConvertingTheSharedZoom() {
        val tooWide = MapCamera(zoom = -5.0).toGoogleCameraPosition(minZoom = 2f, maxZoom = 20f)
        val tooClose = MapCamera(zoom = 24.0).toGoogleCameraPosition(minZoom = 2f, maxZoom = 20f)
        assertEquals(2f, tooWide.zoom, 0f)
        assertEquals(1.0, tooWide.toNativeCamera().zoom, 0.0)
        assertEquals(20f, tooClose.zoom, 0f)
        assertEquals(19.0, tooClose.toNativeCamera().zoom, 0.0)
    }

    @Test fun panelAndKeyboardPaddingKeepAMinimumMapRegionAndRejectNegativeInsets() {
        assertEquals(80 to 440, googleMapPadding(1000, 2f, 80, 440))
        assertEquals(80 to 24, googleMapPadding(200, 2f, 80, 440))
        assertEquals(0 to 0, googleMapPadding(40, 2f, 80, 440))
        assertEquals(0 to 0, googleMapPadding(1000, 2f, -80, -440))
    }

    private fun assertCamera(expected: MapCamera, actual: MapCamera) {
        assertEquals(expected.latitude, actual.latitude, 0.0000001)
        assertEquals(expected.longitude, actual.longitude, 0.0000001)
        assertEquals(expected.zoom, actual.zoom, 0.00001)
        assertEquals(expected.bearing, actual.bearing, 0.00001)
        assertEquals(expected.tilt, actual.tilt, 0.00001)
    }
}
