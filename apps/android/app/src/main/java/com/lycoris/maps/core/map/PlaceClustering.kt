package com.lycoris.maps.core.map

import com.lycoris.maps.core.device.HeadingAccuracy
import com.lycoris.maps.core.device.HeadingState
import com.lycoris.maps.core.device.HeadingStatus
import com.lycoris.maps.core.model.Marker
import com.lycoris.maps.core.model.PlaceCategory
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.sinh
import kotlin.math.sin

internal data class PlaceSymbol(
    val key: String,
    val latitude: Double,
    val longitude: Double,
    val memberIds: List<Long>,
    /** Null denotes a mixed cluster, not the application's "other" category. */
    val category: PlaceCategory?,
) {
    val clustered: Boolean get() = memberIds.size >= PlaceClustering.MINIMUM_CLUSTER_SIZE
    val count: Int get() = memberIds.size
}

/**
 * Deterministic, screen-scale grouping. Buckets index cluster anchors, not every pair of points,
 * keeping dense viewports inexpensive. Each member is within radiusDp of its stable anchor.
 * Small groups remain individual pins; the renderer must not hide them with collision placement.
 */
internal object PlaceClustering {
    const val MINIMUM_CLUSTER_SIZE = 10
    const val MAXIMUM_CLUSTER_ZOOM = 17
    private const val MAX_MERCATOR_LATITUDE = 85.0511287798066

    fun zoomBand(zoom: Double): Int = if (zoom.isFinite()) floor(zoom).toInt().coerceIn(0, 22) else 0

    fun cluster(markers: List<Marker>, zoom: Double, radiusDp: Double = 48.0): List<PlaceSymbol> {
        require(radiusDp.isFinite() && radiusDp > 0.0)
        // Stable ID ordering also resolves duplicate revisions without depending on request order.
        val ordered = markers.asSequence().filter { it.hasValidLocation && !it.deactivated }
            .sortedWith(compareBy<Marker> { it.id }.thenByDescending { it.version }
                .thenBy { it.lat }.thenBy { it.lng }.thenBy { it.category })
            .distinctBy { it.id }.toList()
        val band = zoomBand(zoom)
        if (band > MAXIMUM_CLUSTER_ZOOM) return ordered.map(::individual)
        val worldSize = 512.0 * 2.0.pow(band)
        val radius = radiusDp / worldSize
        val columns = ceil(1.0 / radius).toInt().coerceAtLeast(1)
        val cellSize = 1.0 / columns
        val neighboringCells = ceil(radius / cellSize).toInt()
        val buckets = HashMap<Cell, MutableList<Group>>()
        val groups = ArrayList<Group>()
        for (marker in ordered) {
            val point = project(marker.lat, marker.lng)
            val cell = Cell(floor(point.x / cellSize).toInt().coerceAtMost(columns - 1), floor(point.y / cellSize).toInt())
            var closest: Group? = null
            var closestDistance = radius * radius
            for (dy in -neighboringCells..neighboringCells) {
                for (dx in -neighboringCells..neighboringCells) {
                    val x = ((cell.x + dx) % columns + columns) % columns
                    for (group in buckets[Cell(x, cell.y + dy)].orEmpty()) {
                        val deltaX = wrappedDelta(point.x - group.anchor.x)
                        val deltaY = point.y - group.anchor.y
                        val distance = deltaX * deltaX + deltaY * deltaY
                        if (distance < closestDistance || (distance == closestDistance &&
                                (closest == null || group.members.first().id < closest.members.first().id))) {
                            closest = group
                            closestDistance = distance
                        }
                    }
                }
            }
            if (closest == null) {
                val group = Group(point, mutableListOf(marker), point.x, point.y)
                groups.add(group)
                buckets.getOrPut(cell) { ArrayList() }.add(group)
            } else {
                closest.members.add(marker)
                closest.totalX += closest.anchor.x + wrappedDelta(point.x - closest.anchor.x)
                closest.totalY += point.y
            }
        }
        return groups.flatMap { group ->
            if (group.members.size < MINIMUM_CLUSTER_SIZE) group.members.map(::individual)
            else {
                val center = inverse(group.totalX / group.members.size, group.totalY / group.members.size)
                val categories = group.members.map { it.placeCategory }.distinct()
                listOf(PlaceSymbol("c:${group.members.first().id}", center.first, center.second,
                    group.members.map { it.id }, categories.singleOrNull()))
            }
        }.sortedBy { it.memberIds.first() }
    }

    private fun individual(marker: Marker) = PlaceSymbol(
        "p:${marker.id}", marker.lat, marker.lng, listOf(marker.id), marker.placeCategory,
    )

    private fun project(latitude: Double, longitude: Double): WorldPoint {
        val sine = sin(Math.toRadians(latitude.coerceIn(-MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE)))
        val x = ((longitude + 180.0) / 360.0) % 1.0
        val y = (0.5 - ln((1 + sine) / (1 - sine)) / (4 * PI)).coerceIn(0.0, 1.0)
        return WorldPoint(x, y)
    }

    private fun inverse(x: Double, y: Double): Pair<Double, Double> {
        val longitude = (((x % 1.0) + 1.0) % 1.0) * 360.0 - 180.0
        return Math.toDegrees(atan(sinh(PI * (1 - 2 * y)))) to longitude
    }

    private fun wrappedDelta(value: Double): Double = value - floor(value + 0.5)
    private data class Cell(val x: Int, val y: Int)
    private data class WorldPoint(val x: Double, val y: Double)
    private data class Group(val anchor: WorldPoint, val members: MutableList<Marker>, var totalX: Double, var totalY: Double)
}

/** READY alone is not enough if a controller emits a stale or unreliable sample. */
internal fun reliableHeadingDegrees(heading: HeadingState?, nowNanos: Long): Double? {
    if (heading == null || heading.status != HeadingStatus.READY || heading.accuracy < HeadingAccuracy.MEDIUM) return null
    val timestamp = heading.elapsedRealtimeNanos ?: return null
    if (timestamp <= 0L || timestamp > nowNanos || nowNanos - timestamp > 2_000_000_000L) return null
    return heading.degrees?.takeIf { it.isFinite() }?.let { ((it % 360.0) + 360.0) % 360.0 }
}
