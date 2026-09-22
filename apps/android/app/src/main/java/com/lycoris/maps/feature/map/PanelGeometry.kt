package com.lycoris.maps.feature.map

import kotlin.math.abs

enum class PanelStop { COLLAPSED, MIDDLE, EXPANDED }

/** All values use the caller's unit (pixels at runtime). No viewport percentages. */
data class PanelGeometry(val full: Float, val middle: Float, val collapsed: Float) {
    fun offset(stop: PanelStop): Float = full - when (stop) {
        PanelStop.COLLAPSED -> collapsed
        PanelStop.MIDDLE -> middle
        PanelStop.EXPANDED -> full
    }

    fun destination(offset: Float, velocity: Float, velocityThreshold: Float): PanelStop {
        val stops = PanelStop.entries.distinctBy { offset(it) }.sortedBy { offset(it) }
        if (velocity > velocityThreshold) return stops.firstOrNull { offset(it) > offset + 1f } ?: stops.last()
        if (velocity < -velocityThreshold) return stops.lastOrNull { offset(it) < offset - 1f } ?: stops.first()
        return stops.minBy { abs(offset(it) - offset) }
    }

    companion object {
        fun measure(available: Float, content: Float, middleContent: Float, collapsed: Float): PanelGeometry {
            val full = content.coerceIn(collapsed.coerceAtMost(available), available)
            return PanelGeometry(full, middleContent.coerceIn(collapsed.coerceAtMost(full), full), collapsed.coerceAtMost(full))
        }
    }
}
