package com.lycoris.maps.core.map

import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailabilityLight
import com.lycoris.maps.BuildConfig

/** OSM remains usable without a Google key or Play services. No SDK is initialized by this check. */
enum class GoogleMapsAvailability {
    AVAILABLE, NOT_CONFIGURED, PLAY_SERVICES_UNAVAILABLE;

    companion object {
        fun check(context: Context): GoogleMapsAvailability = when {
            !BuildConfig.GOOGLE_MAPS_CONFIGURED -> NOT_CONFIGURED
            GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(context) != ConnectionResult.SUCCESS -> PLAY_SERVICES_UNAVAILABLE
            else -> AVAILABLE
        }
    }
}
