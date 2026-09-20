package com.lycoris.maps.feature.map

import org.junit.Assert.*
import org.junit.Test

class PanelGeometryTest {
    @Test fun shortDetailsHaveNoEmptyExpandedSpace() {
        val geometry = PanelGeometry.measure(820f, 210f, 284f, 52f)
        assertEquals(210f, geometry.full, 0f)
        assertEquals(0f, geometry.offset(PanelStop.MIDDLE), 0f)
        assertEquals(0f, geometry.offset(PanelStop.EXPANDED), 0f)
        assertEquals(PanelStop.MIDDLE, geometry.destination(0f, 0f, 300f))
    }
    @Test fun longSheetStopsAtAvailableSpaceIncludingKeyboard() {
        val geometry = PanelGeometry.measure(320f, 1500f, 400f, 52f)
        assertEquals(320f, geometry.full, 0f)
        assertEquals(320f, geometry.middle, 0f)
        assertEquals(268f, geometry.offset(PanelStop.COLLAPSED), 0f)
    }
    @Test fun fastFlingAdvancesOneStopInDirection() {
        val geometry = PanelGeometry.measure(800f, 1200f, 284f, 52f)
        assertEquals(PanelStop.EXPANDED, geometry.destination(geometry.offset(PanelStop.MIDDLE), -600f, 300f))
        assertEquals(PanelStop.COLLAPSED, geometry.destination(geometry.offset(PanelStop.MIDDLE), 600f, 300f))
        assertEquals(PanelStop.MIDDLE, geometry.destination(30f, 600f, 300f))
    }
    @Test fun tinyWindowNeverProducesNegativeOffset() {
        val geometry = PanelGeometry.measure(40f, 100f, 284f, 52f)
        PanelStop.entries.forEach { assertEquals(0f, geometry.offset(it), 0f) }
    }
}
