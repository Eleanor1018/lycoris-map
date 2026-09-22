package com.lycoris.maps.core.device

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Build
import android.app.AppOpsManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.MainThread
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Foreground-only system location, with no Google Play dependency.
 *
 * Call [start] from the visible map's ON_START/ON_RESUME and after the Activity's permission result;
 * call [stop] at ON_STOP. Request COARSE + FINE together in the Activity. Denial rationale and the
 * distinction between first denial and "don't ask again" belong to that Activity's permission UI.
 * This class never opens a permission dialog, starts a service, or changes the map camera.
 * All public methods and lifecycle callbacks must run on the main thread.
 */
class LocationController(context: Context, private val acquisitionTimeoutMillis: Long = 20_000L) {
    private val context = context.applicationContext
    private val manager = context.getSystemService(LocationManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private val mutableState = MutableStateFlow(LocationState())
    val state: StateFlow<LocationState> = mutableState.asStateFlow()
    private var started = false
    private var listening: LocationListener? = null
    private var generation = 0L
    private var observersRegistered = false
    private var deadline: Runnable? = null
    private var fixExpiry: Runnable? = null

    init { require(acquisitionTimeoutMillis in 1_000L..60_000L) }

    private val permissionObserver = PermissionObserver(
        this.context, setOf(AppOpsManager.OPSTR_FINE_LOCATION, AppOpsManager.OPSTR_COARSE_LOCATION),
    ) { if (started) refreshPermission() }
    private val providerReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (started) beginAcquisition()
        }
    }

    @MainThread
    fun currentPermission(): LocationPermission = when {
        granted(Manifest.permission.ACCESS_FINE_LOCATION) -> LocationPermission.PRECISE
        granted(Manifest.permission.ACCESS_COARSE_LOCATION) -> LocationPermission.APPROXIMATE
        else -> LocationPermission.NONE
    }

    @MainThread
    fun start() {
        checkMainThread()
        if (started) {
            refreshPermission()
            if (state.value.status in setOf(LocationStatus.TIMED_OUT, LocationStatus.UNAVAILABLE)) beginAcquisition()
            return
        }
        started = true
        permissionObserver.start()
        ContextCompat.registerReceiver(
            context, providerReceiver, IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        observersRegistered = true
        beginAcquisition()
    }

    @MainThread
    fun refreshPermission() {
        checkMainThread()
        val permission = currentPermission()
        if (permission != state.value.permission) {
            // A precise fix cannot remain visible after the user downgrades to approximate.
            mutableState.value = LocationState(permission = permission)
            if (started) beginAcquisition()
            else if (permission == LocationPermission.NONE) {
                mutableState.value = LocationState(LocationStatus.PERMISSION_REQUIRED)
            }
        }
    }

    @MainThread
    fun stop() {
        checkMainThread()
        started = false
        stopListening()
        if (observersRegistered) {
            permissionObserver.stop()
            context.unregisterReceiver(providerReceiver)
            observersRegistered = false
        }
        mutableState.value = state.value.copy(status = LocationStatus.STOPPED)
    }

    @SuppressLint("MissingPermission")
    private fun beginAcquisition() {
        stopListening()
        val permission = currentPermission()
        if (permission == LocationPermission.NONE) {
            mutableState.value = LocationState(LocationStatus.PERMISSION_REQUIRED)
            return
        }
        val previous = state.value.fix?.takeIf {
            state.value.permission == permission && LocationFixPolicy.isValid(it, SystemClock.elapsedRealtimeNanos())
        }
        mutableState.value = LocationState(LocationStatus.ACQUIRING, permission, previous)
        previous?.let(::watchFixExpiry)
        if (manager == null) {
            mutableState.value = state.value.copy(status = LocationStatus.UNAVAILABLE, fix = null)
            return
        }
        val providers = try {
            manager.getProviders(true).filter {
                it == LocationManager.NETWORK_PROVIDER ||
                    (it == LocationManager.GPS_PROVIDER &&
                        (permission == LocationPermission.PRECISE || Build.VERSION.SDK_INT >= 31)) ||
                    (Build.VERSION.SDK_INT >= 31 && it == LocationManager.FUSED_PROVIDER)
            }
        } catch (_: SecurityException) {
            mutableState.value = LocationState(LocationStatus.PERMISSION_REQUIRED)
            return
        }
        if (providers.isEmpty()) {
            val locationEnabled = androidx.core.location.LocationManagerCompat.isLocationEnabled(manager)
            mutableState.value = state.value.copy(
                status = if (locationEnabled) LocationStatus.UNAVAILABLE else LocationStatus.DISABLED, fix = null,
            )
            return
        }
        val requestGeneration = generation
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (!started || generation != requestGeneration) return
                if (currentPermission() != permission) { refreshPermission(); return }
                accept(location, permission)
            }
            override fun onProviderDisabled(provider: String) {
                if (started && generation == requestGeneration) beginAcquisition()
            }
            override fun onProviderEnabled(provider: String) {
                if (started && generation == requestGeneration) beginAcquisition()
            }
            @Deprecated("Required for Android 8 and 9 compatibility")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        }
        listening = listener
        var registered = 0
        providers.forEach { provider ->
            try {
                manager.getLastKnownLocation(provider)?.let { accept(it, permission) }
                manager.requestLocationUpdates(provider, 2_000L, 2f, listener, Looper.getMainLooper())
                registered += 1
            } catch (_: SecurityException) {
                // An OEM may restrict an individual provider. Keep a permitted provider running.
            } catch (_: IllegalArgumentException) {
                // Provider disappeared while settings were changing.
            }
        }
        if (currentPermission() != permission) { refreshPermission(); return }
        if (registered == 0) {
            stopListening()
            mutableState.value = state.value.copy(status = LocationStatus.UNAVAILABLE, fix = null)
        } else if (state.value.fix != null) {
            mutableState.value = state.value.copy(status = LocationStatus.READY)
        } else {
            deadline = Runnable {
                if (started && generation == requestGeneration && state.value.fix == null) {
                    stopListening()
                    mutableState.value = state.value.copy(status = LocationStatus.TIMED_OUT)
                }
            }.also { handler.postDelayed(it, acquisitionTimeoutMillis) }
        }
    }

    private fun accept(location: Location, permission: LocationPermission) {
        if (!location.hasAccuracy()) return
        val fix = DeviceLocation(
            latitude = location.latitude, longitude = location.longitude,
            accuracyMeters = location.accuracy,
            altitudeMeters = location.altitude.takeIf { location.hasAltitude() && it.isFinite() },
            timestampMillis = location.time, elapsedRealtimeNanos = location.elapsedRealtimeNanos,
            approximate = permission == LocationPermission.APPROXIMATE,
        )
        if (!LocationFixPolicy.isValid(fix, SystemClock.elapsedRealtimeNanos()) ||
            !LocationFixPolicy.shouldReplace(state.value.fix, fix)) return
        deadline?.let(handler::removeCallbacks)
        deadline = null
        mutableState.value = LocationState(LocationStatus.READY, permission, fix)
        watchFixExpiry(fix)
    }

    private fun watchFixExpiry(fix: DeviceLocation) {
        fixExpiry?.let(handler::removeCallbacks)
        val remaining = LocationFixPolicy.MAX_AGE_MILLIS - fix.ageMillis(SystemClock.elapsedRealtimeNanos()) + 1L
        fixExpiry = Runnable {
            if (started && state.value.fix == fix) beginAcquisition()
        }.also { handler.postDelayed(it, remaining.coerceAtLeast(1L)) }
    }

    private fun stopListening() {
        generation += 1
        deadline?.let(handler::removeCallbacks)
        deadline = null
        fixExpiry?.let(handler::removeCallbacks)
        fixExpiry = null
        listening?.let { listener -> runCatching { manager?.removeUpdates(listener) } }
        listening = null
    }

    private fun granted(permission: String) =
        canAccessPermission(context, permission, if (permission == Manifest.permission.ACCESS_FINE_LOCATION) {
            AppOpsManager.OPSTR_FINE_LOCATION
        } else AppOpsManager.OPSTR_COARSE_LOCATION)
}

internal fun checkMainThread() {
    check(Looper.myLooper() == Looper.getMainLooper()) { "Device controllers require the main thread" }
}
