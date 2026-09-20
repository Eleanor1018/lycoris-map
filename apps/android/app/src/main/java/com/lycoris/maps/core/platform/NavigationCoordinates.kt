package com.lycoris.maps.core.platform

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.*

/** All application inputs remain WGS84; provider-specific values live only at the outgoing boundary. */
data class NavigationPoint(val latitude: Double, val longitude: Double) {
    init {
        require(latitude.isFinite() && latitude in -90.0..90.0)
        require(longitude.isFinite() && longitude in -180.0..180.0)
    }
}

/** Same public-domain Natural Earth mask as iOS. This is conversion coverage, not political borders. */
class MainlandCoverage private constructor(private val strips: Map<Int, List<Edge>>) {
    private data class Edge(val x: Double, val y: Double, val nextX: Double, val nextY: Double)

    fun contains(point: NavigationPoint): Boolean {
        if (!mayContain(point)) return false
        var inside = false
        for (edge in strips[floor(point.latitude).toInt()].orEmpty()) {
            if ((edge.y > point.latitude) == (edge.nextY > point.latitude)) continue
            val crossing = (edge.nextX - edge.x) * (point.latitude - edge.y) / (edge.nextY - edge.y) + edge.x
            if (point.longitude < crossing) inside = !inside
        }
        return inside
    }

    companion object {
        fun mayContain(point: NavigationPoint): Boolean =
            point.latitude in 18.0..54.0 && point.longitude in 73.0..136.0

        fun fromJson(json: String): MainlandCoverage? = runCatching {
            val geometry = Json.parseToJsonElement(json).jsonObject
            require(geometry["type"]?.jsonPrimitive?.content == "MultiPolygon")
            val polygons = geometry.getValue("coordinates").jsonArray
            require(polygons.isNotEmpty())
            val strips = mutableMapOf<Int, MutableList<Edge>>()
            for (polygon in polygons) {
                require(polygon.jsonArray.isNotEmpty())
                for (rawRing in polygon.jsonArray) {
                    val ring = rawRing.jsonArray.map {
                        val pair = it.jsonArray
                        require(pair.size == 2)
                        NavigationPoint(pair[1].jsonPrimitive.double, pair[0].jsonPrimitive.double)
                    }
                    require(ring.size >= 4 && ring.first() == ring.last())
                    for ((a, b) in ring.zipWithNext()) {
                        if (a.latitude == b.latitude) continue
                        val edge = Edge(a.longitude, a.latitude, b.longitude, b.latitude)
                        for (strip in floor(min(a.latitude, b.latitude)).toInt()..floor(max(a.latitude, b.latitude)).toInt()) {
                            strips.getOrPut(strip) { mutableListOf() }.add(edge)
                        }
                    }
                }
            }
            require(strips.isNotEmpty())
            MainlandCoverage(strips)
        }.getOrNull()
    }
}

/**
 * Approximate GCJ02/BD09 formulas adapted from MIT-licensed wandergis/coordtransform (see assets).
 * Iterative inverses remove the usual single-step round-trip error; they do not turn the regional
 * formula or the coverage mask into survey-grade data. Never use this for stored/API coordinates.
 */
class NavigationCoordinates(private val coverage: MainlandCoverage) {
    fun isMainland(point: NavigationPoint): Boolean = coverage.contains(point)

    fun wgs84ToGcj02(point: NavigationPoint): NavigationPoint =
        if (coverage.contains(point)) gcjForward(point) else point

    /** Null denotes a coastline/border overlap where the piecewise inverse is ambiguous. */
    fun gcj02ToWgs84(point: NavigationPoint): NavigationPoint? {
        if (!MainlandCoverage.mayContain(point)) return point
        val candidate = inverse(point, ::gcjForward)
        val rawInside = coverage.contains(point)
        val candidateInside = coverage.contains(candidate)
        if (rawInside != candidateInside) return null
        return if (candidateInside) candidate else point
    }

    fun wgs84ToBd09(point: NavigationPoint): NavigationPoint =
        if (coverage.contains(point)) bdForward(gcjForward(point)) else point

    /** Outside the mainland, the outgoing Baidu builder explicitly sends WGS84 instead of BD09. */
    fun bd09ToWgs84(point: NavigationPoint): NavigationPoint? {
        if (!MainlandCoverage.mayContain(point)) return point
        val gcj = inverse(point, ::bdForward)
        val candidate = inverse(gcj, ::gcjForward)
        val rawInside = coverage.contains(point)
        val candidateInside = coverage.contains(candidate)
        if (rawInside != candidateInside) return null
        return if (candidateInside) candidate else point
    }

    private fun inverse(point: NavigationPoint, project: (NavigationPoint) -> NavigationPoint): NavigationPoint {
        var candidate = point
        repeat(10) {
            val projected = project(candidate)
            val latitudeError = projected.latitude - point.latitude
            val longitudeError = projected.longitude - point.longitude
            candidate = NavigationPoint(candidate.latitude - latitudeError, candidate.longitude - longitudeError)
            if (max(abs(latitudeError), abs(longitudeError)) < 1e-10) return candidate
        }
        return candidate
    }

    private fun gcjForward(point: NavigationPoint): NavigationPoint {
        val x = point.longitude - 105.0
        val y = point.latitude - 35.0
        val wave = (20.0 * sin(6.0 * x * PI) + 20.0 * sin(2.0 * x * PI)) * 2.0 / 3.0
        var latitude = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * sqrt(abs(x))
        latitude += wave + (20.0 * sin(y * PI) + 40.0 * sin(y / 3.0 * PI)) * 2.0 / 3.0
        latitude += (160.0 * sin(y / 12.0 * PI) + 320.0 * sin(y * PI / 30.0)) * 2.0 / 3.0
        var longitude = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * sqrt(abs(x))
        longitude += wave + (20.0 * sin(x * PI) + 40.0 * sin(x / 3.0 * PI)) * 2.0 / 3.0
        longitude += (150.0 * sin(x / 12.0 * PI) + 300.0 * sin(x / 30.0 * PI)) * 2.0 / 3.0
        val radians = point.latitude / 180.0 * PI
        val eccentricity = 0.00669342162296594323
        val magic = 1.0 - eccentricity * sin(radians).pow(2)
        val root = sqrt(magic)
        latitude = latitude * 180.0 / (6_378_245.0 * (1.0 - eccentricity) / (magic * root) * PI)
        longitude = longitude * 180.0 / (6_378_245.0 / root * cos(radians) * PI)
        return NavigationPoint(point.latitude + latitude, point.longitude + longitude)
    }

    private fun bdForward(point: NavigationPoint): NavigationPoint {
        val xPi = PI * 3000.0 / 180.0
        val z = sqrt(point.longitude * point.longitude + point.latitude * point.latitude) + 0.00002 * sin(point.latitude * xPi)
        val theta = atan2(point.latitude, point.longitude) + 0.000003 * cos(point.longitude * xPi)
        return NavigationPoint(z * sin(theta) + 0.006, z * cos(theta) + 0.0065)
    }
}
