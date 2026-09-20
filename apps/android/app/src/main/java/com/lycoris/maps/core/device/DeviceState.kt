package com.lycoris.maps.core.device

import kotlin.math.exp

enum class LocationPermission { NONE, APPROXIMATE, PRECISE }
enum class LocationStatus { STOPPED, PERMISSION_REQUIRED, ACQUIRING, READY, DISABLED, UNAVAILABLE, TIMED_OUT }

/** WGS84 fix. elapsedRealtimeNanos is monotonic and must not be persisted across boots. */
data class DeviceLocation(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val altitudeMeters: Double?,
    val timestampMillis: Long,
    val elapsedRealtimeNanos: Long,
    val approximate: Boolean,
) {
    fun ageMillis(nowElapsedNanos: Long): Long =
        ((nowElapsedNanos - elapsedRealtimeNanos).coerceAtLeast(0L) / 1_000_000L)
}

data class LocationState(
    val status: LocationStatus = LocationStatus.STOPPED,
    val permission: LocationPermission = LocationPermission.NONE,
    val fix: DeviceLocation? = null,
)

/** Reject invalid, stale and out-of-order fixes without assuming approximate fixes are inaccurate errors. */
internal object LocationFixPolicy {
    const val MAX_AGE_MILLIS = 60_000L
    fun isValid(fix: DeviceLocation, nowElapsedNanos: Long): Boolean =
        fix.latitude.isFinite() && fix.latitude in -90.0..90.0 &&
            fix.longitude.isFinite() && fix.longitude in -180.0..180.0 &&
            fix.accuracyMeters.isFinite() && fix.accuracyMeters > 0f &&
            fix.elapsedRealtimeNanos > 0 && fix.elapsedRealtimeNanos <= nowElapsedNanos &&
            fix.ageMillis(nowElapsedNanos) <= MAX_AGE_MILLIS

    fun shouldReplace(current: DeviceLocation?, next: DeviceLocation): Boolean =
        current == null || next.elapsedRealtimeNanos > current.elapsedRealtimeNanos ||
            (next.elapsedRealtimeNanos == current.elapsedRealtimeNanos && next.accuracyMeters < current.accuracyMeters)
}

enum class HeadingStatus { STOPPED, UNAVAILABLE, CALIBRATING, READY }
enum class HeadingSource { ROTATION_VECTOR, ACCELEROMETER_MAGNETOMETER }
enum class HeadingAccuracy { UNRELIABLE, LOW, MEDIUM, HIGH }

data class HeadingState(
    val status: HeadingStatus = HeadingStatus.STOPPED,
    val magneticDegrees: Double? = null,
    val trueDegrees: Double? = null,
    val accuracy: HeadingAccuracy = HeadingAccuracy.UNRELIABLE,
    val source: HeadingSource? = null,
    val elapsedRealtimeNanos: Long? = null,
) {
    /** Rendering must subtract the map bearing. A null value means hide the heading cone. */
    val degrees: Double? get() = if (status == HeadingStatus.READY) trueDegrees ?: magneticDegrees else null
}

object HeadingMath {
    fun normalize(degrees: Double): Double {
        require(degrees.isFinite())
        return ((degrees % 360.0) + 360.0) % 360.0
    }

    fun shortestDelta(from: Double, to: Double): Double =
        ((normalize(to) - normalize(from) + 540.0) % 360.0) - 180.0

    /** Smoothing across north must rotate 359 → 0 → 1, never via 180. */
    fun interpolate(from: Double, to: Double, fraction: Double): Double {
        require(fraction.isFinite())
        return normalize(from + shortestDelta(from, to) * fraction.coerceIn(0.0, 1.0))
    }

    fun smoothingFraction(elapsedNanos: Long): Double =
        1.0 - exp(-elapsedNanos.coerceAtLeast(0L).toDouble() / 180_000_000.0)

    fun trueNorth(magnetic: Double, declination: Double): Double = normalize(magnetic + declination)
    fun relativeToMap(heading: Double, mapBearing: Double): Double = normalize(heading - mapBearing)
}

enum class VoiceStatus { IDLE, PERMISSION_REQUIRED, UNAVAILABLE, STARTING, LISTENING, PROCESSING, RESULT, ERROR, DESTROYED }
enum class VoiceError { NO_SPEECH, NO_MATCH, AUDIO, PERMISSION, BUSY, LANGUAGE_UNAVAILABLE, SERVICE, TIMED_OUT }

data class VoiceState(
    val status: VoiceStatus = VoiceStatus.IDLE,
    val transcript: String = "",
    val error: VoiceError? = null,
) {
    val isActive: Boolean get() = status in setOf(VoiceStatus.STARTING, VoiceStatus.LISTENING, VoiceStatus.PROCESSING)
}

internal fun firstVoiceResult(results: List<String>?): String? =
    results?.firstOrNull { it.isNotBlank() }?.trim()

/** Reject untrustworthy compass samples instead of displaying a plausible but invented bearing. */
internal object HeadingSamplePolicy {
    const val STALE_NANOS = 2_000_000_000L
    const val MAX_ESTIMATED_ERROR_RADIANS = Math.PI / 4.0

    fun canUse(
        accuracy: HeadingAccuracy,
        timestampNanos: Long,
        nowNanos: Long,
        estimatedErrorRadians: Float? = null,
    ): Boolean = accuracy >= HeadingAccuracy.MEDIUM && timestampNanos > 0L &&
        timestampNanos <= nowNanos && nowNanos - timestampNanos <= STALE_NANOS &&
        (estimatedErrorRadians == null || estimatedErrorRadians == -1f ||
            (estimatedErrorRadians.isFinite() && estimatedErrorRadians in 0.0..MAX_ESTIMATED_ERROR_RADIANS))

    /** The screen's top edge has no useful compass direction when it points almost vertically. */
    fun projectedBearing(east: Float, north: Float): Double? {
        if (!east.isFinite() || !north.isFinite() || east * east + north * north < 0.01f) return null
        return HeadingMath.normalize(Math.toDegrees(kotlin.math.atan2(east.toDouble(), north.toDouble())))
    }
}

internal class HeadingSmoother {
    private var heading: Double? = null
    private var timestampNanos: Long? = null

    fun reset() { heading = null; timestampNanos = null }

    fun update(degrees: Double, timestamp: Long): Double? {
        if (!degrees.isFinite() || timestamp <= 0L) return null
        val previousTimestamp = timestampNanos
        if (previousTimestamp != null && timestamp <= previousTimestamp) return null
        val previous = heading
        val next = if (previous == null || previousTimestamp == null ||
            timestamp - previousTimestamp > HeadingSamplePolicy.STALE_NANOS) {
            HeadingMath.normalize(degrees)
        } else {
            HeadingMath.interpolate(previous, degrees, HeadingMath.smoothingFraction(timestamp - previousTimestamp))
        }
        timestampNanos = timestamp
        heading = next
        return next
    }
}

/** Session identity ensures callbacks from cancelled/destroyed recognizers cannot submit searches. */
internal class VoiceSessionMachine {
    private val mutableState = kotlinx.coroutines.flow.MutableStateFlow(VoiceState())
    val state: kotlinx.coroutines.flow.StateFlow<VoiceState> = mutableState
    private var generation = 0L
    private var active: Long? = null
    private var destroyed = false

    fun begin(hasPermission: Boolean, available: Boolean): Long? {
        if (destroyed) return null
        active = null
        generation += 1
        if (!available) { mutableState.value = VoiceState(VoiceStatus.UNAVAILABLE); return null }
        if (!hasPermission) { mutableState.value = VoiceState(VoiceStatus.PERMISSION_REQUIRED); return null }
        active = generation
        mutableState.value = VoiceState(VoiceStatus.STARTING)
        return generation
    }

    fun isCurrent(token: Long): Boolean = !destroyed && active == token
    fun listening(token: Long) {
        if (isCurrent(token)) mutableState.value = VoiceState(VoiceStatus.LISTENING)
    }
    fun processing(token: Long) {
        if (isCurrent(token)) mutableState.value = state.value.copy(status = VoiceStatus.PROCESSING)
    }
    fun result(token: Long, results: List<String>?) {
        if (!isCurrent(token)) return
        val text = firstVoiceResult(results)
        if (text == null) fail(token, VoiceError.NO_MATCH)
        else {
            active = null
            mutableState.value = VoiceState(VoiceStatus.RESULT, transcript = text)
        }
    }
    fun fail(token: Long, error: VoiceError) {
        if (!isCurrent(token)) return
        active = null
        mutableState.value = VoiceState(
            status = if (error == VoiceError.PERMISSION) VoiceStatus.PERMISSION_REQUIRED else VoiceStatus.ERROR,
            error = error,
        )
    }
    fun cancel() {
        if (destroyed) return
        active = null
        generation += 1
        mutableState.value = VoiceState()
    }
    fun destroy() {
        cancel()
        destroyed = true
        mutableState.value = VoiceState(VoiceStatus.DESTROYED)
    }
}
