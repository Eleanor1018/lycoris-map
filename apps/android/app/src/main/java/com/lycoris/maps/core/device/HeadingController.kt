package com.lycoris.maps.core.device

import android.content.Context
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Surface
import androidx.annotation.MainThread
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.abs

/**
 * North-referenced foreground compass. No game rotation vector, GPS-course substitution, or GMS.
 * Bind start/stop to the visible map's lifecycle. Supply the current display rotation (also on
 * configuration/display changes) and the latest permitted location for true-north correction.
 * Use HeadingState.degrees minus the map bearing when drawing the cone; null hides it.
 */
class HeadingController(context: Context) : SensorEventListener {
    private val manager = context.applicationContext.getSystemService(SensorManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private val mutableState = MutableStateFlow(HeadingState())
    val state: StateFlow<HeadingState> = mutableState.asStateFlow()
    private val smoother = HeadingSmoother()
    private val rotationMatrix = FloatArray(9)
    private val screenMatrix = FloatArray(9)
    private val gravity = FloatArray(3)
    private val magnetic = FloatArray(3)
    private var gravityTimestamp = 0L
    private var magneticTimestamp = 0L
    private var magneticAccuracy = HeadingAccuracy.UNRELIABLE
    private var source: HeadingSource? = null
    private var started = false
    private var displayRotation = Surface.ROTATION_0
    private var declination: Double? = null
    private var expiry: Runnable? = null

    @MainThread
    fun start() {
        checkMainThread()
        if (started) return
        started = true
        smoother.reset()
        gravityTimestamp = 0L
        magneticTimestamp = 0L
        magneticAccuracy = HeadingAccuracy.UNRELIABLE
        if (manager == null) { unavailable(); return }
        val vector = manager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        if (vector != null && manager.registerListener(this, vector, SensorManager.SENSOR_DELAY_UI, handler)) {
            source = HeadingSource.ROTATION_VECTOR
        } else {
            // TYPE_GAME_ROTATION_VECTOR intentionally excluded: it cannot reference north.
            val acceleration = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            val magnetometer = manager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
            if (acceleration == null || magnetometer == null ||
                !manager.registerListener(this, acceleration, SensorManager.SENSOR_DELAY_UI, handler) ||
                !manager.registerListener(this, magnetometer, SensorManager.SENSOR_DELAY_UI, handler)) {
                manager.unregisterListener(this)
                unavailable()
                return
            }
            source = HeadingSource.ACCELEROMETER_MAGNETOMETER
        }
        mutableState.value = HeadingState(status = HeadingStatus.CALIBRATING, source = source)
    }

    @MainThread
    fun stop() {
        checkMainThread()
        started = false
        manager?.unregisterListener(this)
        expiry?.let(handler::removeCallbacks)
        expiry = null
        smoother.reset()
        mutableState.value = HeadingState()
    }

    @MainThread
    fun setDisplayRotation(rotation: Int) {
        checkMainThread()
        require(rotation in Surface.ROTATION_0..Surface.ROTATION_270)
        if (displayRotation == rotation) return
        displayRotation = rotation
        // A 90° screen change is not physical motion and must not be animated through old axes.
        smoother.reset()
        if (started && source != null) calibrating()
    }

    @MainThread
    fun updateLocation(fix: DeviceLocation?) {
        checkMainThread()
        declination = fix?.takeIf { LocationFixPolicy.isValid(it, SystemClock.elapsedRealtimeNanos()) }?.let {
            GeomagneticField(
                it.latitude.toFloat(), it.longitude.toFloat(), (it.altitudeMeters ?: 0.0).toFloat(),
                System.currentTimeMillis(),
            ).declination.toDouble().takeIf(Double::isFinite)
        }
        val current = state.value
        if (current.status == HeadingStatus.READY) {
            mutableState.value = current.copy(
                trueDegrees = current.magneticDegrees?.let { magnetic ->
                    declination?.let { HeadingMath.trueNorth(magnetic, it) }
                },
            )
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (!started || source == null) return
        val now = SystemClock.elapsedRealtimeNanos()
        var accuracy: HeadingAccuracy
        when (event.sensor.type) {
            Sensor.TYPE_ROTATION_VECTOR -> {
                if (source != HeadingSource.ROTATION_VECTOR) return
                accuracy = event.accuracy.toHeadingAccuracy()
                if (event.values.size < 3 || event.values.take(4).any { !it.isFinite() } ||
                    !HeadingSamplePolicy.canUse(accuracy, event.timestamp, now, event.values.getOrNull(4))) {
                    calibrating(accuracy); return
                }
                SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
            }
            Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_MAGNETIC_FIELD -> {
                if (source != HeadingSource.ACCELEROMETER_MAGNETOMETER) return
                if (event.values.size < 3 || event.values.take(3).any { !it.isFinite() }) {
                    calibrating(); return
                }
                if (event.sensor.type == Sensor.TYPE_ACCELEROMETER) {
                    event.values.copyInto(gravity, endIndex = 3)
                    gravityTimestamp = event.timestamp
                } else {
                    event.values.copyInto(magnetic, endIndex = 3)
                    magneticTimestamp = event.timestamp
                    magneticAccuracy = event.accuracy.toHeadingAccuracy()
                }
                accuracy = magneticAccuracy
                if (!HeadingSamplePolicy.canUse(accuracy, gravityTimestamp, now) ||
                    !HeadingSamplePolicy.canUse(accuracy, magneticTimestamp, now) ||
                    abs(gravityTimestamp - magneticTimestamp) > 250_000_000L ||
                    !SensorManager.getRotationMatrix(rotationMatrix, null, gravity, magnetic)) {
                    calibrating(accuracy); return
                }
            }
            else -> return
        }
        val axes = when (displayRotation) {
            Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
            Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
            Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
            else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
        }
        if (!SensorManager.remapCoordinateSystem(rotationMatrix, axes.first, axes.second, screenMatrix)) {
            calibrating(accuracy); return
        }
        val rawHeading = HeadingSamplePolicy.projectedBearing(screenMatrix[1], screenMatrix[4])
            ?: run { calibrating(accuracy); return }
        val magneticHeading = smoother.update(rawHeading, event.timestamp) ?: return
        mutableState.value = HeadingState(
            status = HeadingStatus.READY,
            magneticDegrees = magneticHeading,
            trueDegrees = declination?.let { HeadingMath.trueNorth(magneticHeading, it) },
            accuracy = accuracy, source = source, elapsedRealtimeNanos = event.timestamp,
        )
        expiry?.let(handler::removeCallbacks)
        val sampleTimestamp = event.timestamp
        expiry = Runnable {
            if (started && state.value.elapsedRealtimeNanos == sampleTimestamp) calibrating()
        }.also { handler.postDelayed(it, HeadingSamplePolicy.STALE_NANOS / 1_000_000L) }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        if (!started) return
        if (sensor?.type == Sensor.TYPE_MAGNETIC_FIELD) magneticAccuracy = accuracy.toHeadingAccuracy()
        if ((sensor?.type == Sensor.TYPE_ROTATION_VECTOR || sensor?.type == Sensor.TYPE_MAGNETIC_FIELD) &&
            accuracy.toHeadingAccuracy() < HeadingAccuracy.MEDIUM) calibrating(accuracy.toHeadingAccuracy())
    }

    private fun unavailable() {
        source = null
        mutableState.value = HeadingState(status = HeadingStatus.UNAVAILABLE)
    }

    private fun calibrating(accuracy: HeadingAccuracy = HeadingAccuracy.UNRELIABLE) {
        smoother.reset()
        mutableState.value = HeadingState(status = HeadingStatus.CALIBRATING, accuracy = accuracy, source = source)
    }
}

private fun Int.toHeadingAccuracy(): HeadingAccuracy = when (this) {
    SensorManager.SENSOR_STATUS_ACCURACY_HIGH -> HeadingAccuracy.HIGH
    SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM -> HeadingAccuracy.MEDIUM
    SensorManager.SENSOR_STATUS_ACCURACY_LOW -> HeadingAccuracy.LOW
    else -> HeadingAccuracy.UNRELIABLE
}
