package com.lycoris.maps.core.platform

import java.io.File
import org.junit.Assert.*
import org.junit.Test

internal fun realCoverage(): MainlandCoverage {
    val candidates = listOf(File("src/main/assets/MainlandCoverage.json"), File("app/src/main/assets/MainlandCoverage.json"))
    val asset = candidates.firstOrNull(File::isFile) ?: error("Packaged MainlandCoverage asset missing")
    return MainlandCoverage.fromJson(asset.readText()) ?: error("Packaged coverage asset invalid")
}

class NavigationCoordinatesTest {
    private val coverage = realCoverage()
    private val converter = NavigationCoordinates(coverage)

    @Test fun `mainland cities roundtrip GCJ and BD without changing source coordinates`() {
        val cities = listOf(
            NavigationPoint(31.2304, 121.4737), NavigationPoint(39.9042, 116.4074),
            NavigationPoint(22.5431, 114.0579), NavigationPoint(18.2528, 109.5119),
            NavigationPoint(20.0440, 110.1999), NavigationPoint(30.5728, 104.0668),
            NavigationPoint(43.8256, 87.6168), NavigationPoint(45.8038, 126.5349), NavigationPoint(29.6520, 91.1721),
        )
        for (original in cities) {
            assertTrue("$original", coverage.contains(original))
            val gcj = converter.wgs84ToGcj02(original)
            assertNotEquals(original, gcj)
            assertClose(original, converter.gcj02ToWgs84(gcj)!!)
            val bd = converter.wgs84ToBd09(original)
            assertNotEquals(gcj, bd)
            assertClose(original, converter.bd09ToWgs84(bd)!!)
        }
    }

    @Test fun `outside mainland locations including rectangle neighbors remain WGS84`() {
        val outside = listOf(
            NavigationPoint(22.3193, 114.1694), NavigationPoint(22.1987, 113.5439),
            NavigationPoint(25.0330, 121.5654), NavigationPoint(37.5665, 126.9780),
            NavigationPoint(21.0278, 105.8342), NavigationPoint(35.6762, 139.6503),
            NavigationPoint(27.7172, 85.3240), NavigationPoint(43.1155, 131.8855),
            NavigationPoint(40.766, -74.077), NavigationPoint(-33.8666, 151.1957), NavigationPoint(0.0, 0.0),
        )
        for (point in outside) {
            assertFalse("$point", coverage.contains(point))
            assertEquals(point, converter.wgs84ToGcj02(point))
            assertEquals(point, converter.wgs84ToBd09(point))
            assertEquals(point, converter.gcj02ToWgs84(point))
            assertEquals(point, converter.bd09ToWgs84(point))
        }
    }

    @Test fun `Shanghai GCJ matches existing independently recorded iOS reference`() {
        val gcj = converter.wgs84ToGcj02(NavigationPoint(31.2304, 121.4737))
        assertEquals(31.22845773757727, gcj.latitude, 1e-9)
        assertEquals(121.47822305927693, gcj.longitude, 1e-9)
    }

    @Test fun `ambiguous coastal inverse cannot move outside point inland`() {
        val mainland = NavigationPoint(22.466, 113.9)
        assertTrue(coverage.contains(mainland))
        val gcj = converter.wgs84ToGcj02(mainland)
        assertFalse(coverage.contains(gcj))
        assertNull(converter.gcj02ToWgs84(gcj))
    }

    @Test fun `invalid points and corrupt coverage cannot produce plausible converted positions`() {
        assertThrows(IllegalArgumentException::class.java) { NavigationPoint(Double.NaN, 0.0) }
        assertThrows(IllegalArgumentException::class.java) { NavigationPoint(0.0, 181.0) }
        assertThrows(IllegalArgumentException::class.java) { NavigationPoint(-91.0, 0.0) }
        assertNull(MainlandCoverage.fromJson("not JSON"))
        assertNull(MainlandCoverage.fromJson("""{"type":"MultiPolygon","coordinates":[]}"""))
        assertNull(MainlandCoverage.fromJson("""{"type":"MultiPolygon","coordinates":[[[[0,0],[1,0],[0,1]]]]}"""))
    }

    private fun assertClose(expected: NavigationPoint, actual: NavigationPoint) {
        assertEquals(expected.latitude, actual.latitude, 1e-8)
        assertEquals(expected.longitude, actual.longitude, 1e-8)
    }
}
