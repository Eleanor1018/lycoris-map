package com.lycoris.maps.core.map

import com.lycoris.maps.core.device.HeadingAccuracy
import com.lycoris.maps.core.device.HeadingState
import com.lycoris.maps.core.device.HeadingStatus
import com.lycoris.maps.core.model.Marker
import com.lycoris.maps.core.model.PlaceCategory
import org.junit.Assert.*
import org.junit.Test

class PlaceClusteringTest {
    private fun marker(id: Long, category: String = "baby_room", lat: Double = 31.2304, lng: Double = 121.4737) =
        Marker(id, lat, lng, category, "Synthetic $id")

    @Test fun nineNearbyPlacesRemainNineIndividualColoredPins() {
        val result = PlaceClustering.cluster((1L..9L).map(::marker), 8.0)
        assertEquals(9, result.size)
        assertTrue(result.all { !it.clustered && it.category == PlaceCategory.BABY_ROOM })
    }

    @Test fun tenNearbyPlacesBecomeOneHomogeneousColoredCluster() {
        val result = PlaceClustering.cluster((1L..10L).map(::marker), 8.0)
        assertEquals(1, result.size)
        assertTrue(result.single().clustered)
        assertEquals(10, result.single().count)
        assertEquals(PlaceCategory.BABY_ROOM, result.single().category)
    }

    @Test fun mixedClusterUsesNeutralCategoryAndNeverPretendsToBeOther() {
        val result = PlaceClustering.cluster((1L..10L).map { marker(it, if (it == 1L) "friendly_clinic" else "baby_room") }, 8.0)
        assertNull(result.single().category)
        assertEquals(PlaceCategory.OTHER, PlaceClustering.cluster(listOf(marker(11, "unknown_category")), 8.0).single().category)
    }

    @Test fun groupingAndIdentifiersAreStableAcrossInputOrder() {
        val points = (1L..30L).map { marker(Long.MAX_VALUE - it, lng = if (it < 15) 121.47 else 122.0) }
        val expected = PlaceClustering.cluster(points, 10.2)
        assertEquals(expected, PlaceClustering.cluster(points.reversed(), 10.9))
        assertEquals(points.map { it.id }.sorted(), expected.flatMap { it.memberIds }.sorted())
        val single = PlaceClustering.cluster(listOf(marker(Long.MAX_VALUE)), 19.0).single()
        assertEquals("p:9223372036854775807", single.key)
    }

    @Test fun pointsAcrossDateLineShareNearbyClusterWithoutGreenwichCenter() {
        val points = (1L..10L).map { marker(it, lat = 0.0, lng = if (it % 2L == 0L) 179.99 else -179.99) }
        val cluster = PlaceClustering.cluster(points, 5.0).single()
        assertEquals(10, cluster.count)
        assertTrue(kotlin.math.abs(cluster.longitude) > 179.9)
        assertEquals(0.0, cluster.latitude, 0.00001)
    }

    @Test fun distantGroupsBelowThresholdDoNotMergeJustBecauseTotalIsTen() {
        val points = (1L..10L).map { marker(it, lng = if (it <= 5) 0.0 else 90.0) }
        assertEquals(10, PlaceClustering.cluster(points, 10.0).size)
    }

    @Test fun invalidDeactivatedAndDuplicatePointsDoNotInflateCount() {
        val points = (1L..9L).map(::marker) + marker(9).copy(version = 2) + marker(10).copy(lat = Double.NaN) +
            marker(11).copy(deactivated = true) + marker(-1)
        assertEquals(9, PlaceClustering.cluster(points, 8.0).size)
        assertEquals(PlaceClustering.cluster(points, 8.0), PlaceClustering.cluster(points.reversed(), 8.0))
    }

    @Test fun highZoomShowsAllIndividualPlacesAndKeepsCategory() {
        val result = PlaceClustering.cluster((1L..20L).map { marker(it, "friendly_clinic") }, 18.0)
        assertEquals(20, result.size)
        assertTrue(result.all { !it.clustered && it.category == PlaceCategory.FRIENDLY_CLINIC })
    }

    @Test fun headingNeedsFreshReliableSampleAndPrefersTrueNorth() {
        val now = 10_000_000_000L
        val valid = HeadingState(HeadingStatus.READY, magneticDegrees = 359.0, trueDegrees = 1.0,
            accuracy = HeadingAccuracy.HIGH, elapsedRealtimeNanos = now)
        assertEquals(1.0, reliableHeadingDegrees(valid, now)!!, 0.0)
        assertEquals(359.0, reliableHeadingDegrees(valid.copy(trueDegrees = null), now)!!, 0.0)
        assertNull(reliableHeadingDegrees(valid.copy(accuracy = HeadingAccuracy.LOW), now))
        assertNull(reliableHeadingDegrees(valid.copy(status = HeadingStatus.CALIBRATING), now))
        assertNull(reliableHeadingDegrees(valid.copy(elapsedRealtimeNanos = now - 3_000_000_000L), now))
        assertNull(reliableHeadingDegrees(valid.copy(trueDegrees = Double.NaN), now))
    }
}
