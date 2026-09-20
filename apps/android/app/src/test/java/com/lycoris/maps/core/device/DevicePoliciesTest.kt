package com.lycoris.maps.core.device

import org.junit.Assert.*
import org.junit.Test

class DevicePoliciesTest {
    private fun fix(
        elapsed: Long = 100_000_000_000L,
        latitude: Double = 31.2,
        longitude: Double = 121.4,
        accuracy: Float = 15f,
        approximate: Boolean = false,
    ) = DeviceLocation(latitude, longitude, accuracy, null, 1_750_000_000_000L, elapsed, approximate)

    @Test fun `coarse fix is usable without pretending it is precise`() {
        val coarse = fix(accuracy = 2500f, approximate = true)
        assertTrue(LocationFixPolicy.isValid(coarse, 110_000_000_000L))
        assertTrue(coarse.approximate)
    }

    @Test fun `invalid stale future and reboot fixes are rejected`() {
        assertFalse(LocationFixPolicy.isValid(fix(latitude = Double.NaN), 110_000_000_000L))
        assertFalse(LocationFixPolicy.isValid(fix(latitude = 91.0), 110_000_000_000L))
        assertFalse(LocationFixPolicy.isValid(fix(longitude = -181.0), 110_000_000_000L))
        assertFalse(LocationFixPolicy.isValid(fix(accuracy = 0f), 110_000_000_000L))
        assertFalse(LocationFixPolicy.isValid(fix(accuracy = Float.POSITIVE_INFINITY), 110_000_000_000L))
        assertFalse(LocationFixPolicy.isValid(fix(elapsed = 0), 110_000_000_000L))
        assertFalse(LocationFixPolicy.isValid(fix(), 161_000_000_000L))
        assertFalse(LocationFixPolicy.isValid(fix(), 99_000_000_000L))
        assertTrue(LocationFixPolicy.isValid(fix(), 160_000_000_000L))
    }

    @Test fun `an older provider cannot overwrite a new fix`() {
        assertFalse(LocationFixPolicy.shouldReplace(fix(), fix(elapsed = 99_000_000_000L, accuracy = 1f)))
        assertTrue(LocationFixPolicy.shouldReplace(fix(), fix(elapsed = 101_000_000_000L, accuracy = 100f)))
        assertTrue(LocationFixPolicy.shouldReplace(fix(), fix(accuracy = 5f)))
        assertFalse(LocationFixPolicy.shouldReplace(fix(), fix(accuracy = 20f)))
    }

    @Test fun `heading interpolation crosses north in the short direction`() {
        assertEquals(0.0, HeadingMath.interpolate(359.0, 1.0, 0.5), 1e-9)
        assertEquals(0.0, HeadingMath.interpolate(1.0, 359.0, 0.5), 1e-9)
        assertEquals(350.0, HeadingMath.normalize(-10.0), 1e-9)
        assertEquals(30.0, HeadingMath.relativeToMap(10.0, 340.0), 1e-9)
        assertEquals(5.0, HeadingMath.trueNorth(355.0, 10.0), 1e-9)
    }

    @Test fun `time based smoothing is frame rate independent`() {
        val oneFrame = HeadingMath.interpolate(355.0, 5.0, HeadingMath.smoothingFraction(100_000_000L))
        var twoFrames = HeadingMath.interpolate(355.0, 5.0, HeadingMath.smoothingFraction(50_000_000L))
        twoFrames = HeadingMath.interpolate(twoFrames, 5.0, HeadingMath.smoothingFraction(50_000_000L))
        assertEquals(oneFrame, twoFrames, 1e-9)
        assertEquals(0.0, HeadingMath.smoothingFraction(-1L), 0.0)
    }

    @Test fun `heading smoother ignores late samples and resets after a stale gap`() {
        val smoother = HeadingSmoother()
        assertEquals(359.0, smoother.update(359.0, 1_000_000_000L)!!, 1e-9)
        assertNull(smoother.update(180.0, 1_000_000_000L))
        assertNull(smoother.update(180.0, 999_999_999L))
        val nearNorth = smoother.update(1.0, 1_100_000_000L)!!
        assertTrue(nearNorth > 359.0 || nearNorth < 1.0)
        assertEquals(180.0, smoother.update(180.0, 4_000_000_000L)!!, 1e-9)
        smoother.reset()
        assertEquals(90.0, smoother.update(90.0, 5_000_000_000L)!!, 1e-9)
    }

    @Test fun `unreliable low accuracy stale and future headings never render`() {
        assertFalse(HeadingSamplePolicy.canUse(HeadingAccuracy.UNRELIABLE, 1L, 1L))
        assertFalse(HeadingSamplePolicy.canUse(HeadingAccuracy.LOW, 1L, 1L))
        assertFalse(HeadingSamplePolicy.canUse(HeadingAccuracy.HIGH, 0L, 1L))
        assertFalse(HeadingSamplePolicy.canUse(HeadingAccuracy.HIGH, 2L, 1L))
        assertFalse(HeadingSamplePolicy.canUse(HeadingAccuracy.HIGH, 1L, 3_000_000_000L))
        assertFalse(HeadingSamplePolicy.canUse(HeadingAccuracy.HIGH, 1L, 1L, Float.NaN))
        assertFalse(HeadingSamplePolicy.canUse(HeadingAccuracy.HIGH, 1L, 1L, 1f))
        assertTrue(HeadingSamplePolicy.canUse(HeadingAccuracy.MEDIUM, 1L, 1L, -1f))
        assertTrue(HeadingSamplePolicy.canUse(HeadingAccuracy.HIGH, 1L, 1L, 0.1f))
        assertNull(HeadingState(HeadingStatus.CALIBRATING, magneticDegrees = 10.0).degrees)
    }

    @Test fun `screen top projection preserves compass quadrants and rejects vertical ambiguity`() {
        assertEquals(0.0, HeadingSamplePolicy.projectedBearing(0f, 1f)!!, 1e-9)
        assertEquals(90.0, HeadingSamplePolicy.projectedBearing(1f, 0f)!!, 1e-9)
        assertEquals(180.0, HeadingSamplePolicy.projectedBearing(0f, -1f)!!, 1e-9)
        assertEquals(270.0, HeadingSamplePolicy.projectedBearing(-1f, 0f)!!, 1e-9)
        assertNull(HeadingSamplePolicy.projectedBearing(0.001f, 0.001f))
        assertNull(HeadingSamplePolicy.projectedBearing(Float.NaN, 1f))
    }
}
