package com.lycoris.maps.core.device

internal const val QA_LOCAL_NETWORK_PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK"
internal const val QA_LOCAL_NETWORK_REQUESTED = "qa-local-network-requested"

internal enum class StartupPermission { LOCATION, QA_LOCAL_NETWORK }

/** Automatic startup prompts are sequential and one-shot; explicit user retries live in the UI. */
internal object StartupPermissionPolicy {
    fun requiresQaLocalNetwork(isQaBuild: Boolean, sdk: Int): Boolean = isQaBuild && sdk >= 37

    fun next(
        foreground: Boolean,
        permissionInFlight: Boolean,
        otherDialogOpen: Boolean,
        hasLocation: Boolean,
        locationRequested: Boolean,
        requiresQaLocalNetwork: Boolean,
        hasQaLocalNetwork: Boolean,
        qaLocalNetworkRequested: Boolean,
    ): StartupPermission? = when {
        !foreground || permissionInFlight || otherDialogOpen -> null
        !hasLocation && !locationRequested -> StartupPermission.LOCATION
        requiresQaLocalNetwork && !hasQaLocalNetwork && !qaLocalNetworkRequested -> StartupPermission.QA_LOCAL_NETWORK
        else -> null
    }
}
