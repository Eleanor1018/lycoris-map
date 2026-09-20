package com.lycoris.maps.core.device

import android.app.AppOpsManager
import android.content.Context
import android.os.Handler
import android.os.Looper

/** Public API only. Also refresh permissions on resume; revoked runtime permissions can kill the process. */
internal class PermissionObserver(
    context: Context,
    private val operations: Set<String>,
    private val onChanged: () -> Unit,
) {
    private val packageName = context.packageName
    private val manager = context.getSystemService(AppOpsManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var observing = false
    private val listener = AppOpsManager.OnOpChangedListener { op, changedPackage ->
        if (op in operations && changedPackage == packageName) handler.post {
            if (observing) onChanged()
        }
    }

    fun start() {
        if (observing) return
        observing = true
        operations.forEach { op ->
            // Restricted OEM implementations may reject observation; foreground checks still apply.
            runCatching { manager?.startWatchingMode(op, packageName, listener) }
        }
    }

    fun stop() {
        observing = false
        runCatching { manager?.stopWatchingMode(listener) }
    }
}

/** Runtime grant and an OEM/app-op denial are distinct; both must allow access. */
internal fun canAccessPermission(context: Context, permission: String, operation: String): Boolean {
    if (androidx.core.content.ContextCompat.checkSelfPermission(context, permission) !=
        android.content.pm.PackageManager.PERMISSION_GRANTED) return false
    val manager = context.getSystemService(AppOpsManager::class.java) ?: return true
    @Suppress("DEPRECATION")
    val mode = runCatching { manager.checkOpNoThrow(operation, android.os.Process.myUid(), context.packageName) }
        .getOrDefault(AppOpsManager.MODE_ERRORED)
    return mode == AppOpsManager.MODE_ALLOWED || mode == AppOpsManager.MODE_DEFAULT ||
        (android.os.Build.VERSION.SDK_INT >= 29 && mode == AppOpsManager.MODE_FOREGROUND)
}
