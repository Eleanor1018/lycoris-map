package com.lycoris.maps.core.platform

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Build
import androidx.annotation.MainThread

sealed interface ExternalActionResult {
    data object Opened : ExternalActionResult
    /** Display a message and an explicit button for this URL; do not auto-launch it. */
    data class NoNavigationApp(val fallbackUrl: String) : ExternalActionResult
    data object Unavailable : ExternalActionResult
}

data class InstalledNavigationApp(val packageName: String, val label: String, val provider: NavigationProvider)

/**
 * Enumerates real, exported ACTION_VIEW handlers, then always launches Android's chooser with
 * explicit components. It never remembers or bypasses a user's choice, even for one installed app.
 * Call from an Activity/window context where possible. This class never reads the user's position.
 */
class NavigationLauncher(context: Context, private val tencentDeveloperKey: String? = null) {
    private val appContext = context.applicationContext
    private val packageManager = appContext.packageManager
    private val urls by lazy {
        val coverage = runCatching {
            appContext.assets.open("MainlandCoverage.json").bufferedReader().use { MainlandCoverage.fromJson(it.readText()) }
        }.getOrNull()
        NavigationUrls(coverage?.let(::NavigationCoordinates))
    }
    private data class Target(val provider: NavigationProvider, val info: ResolveInfo, val intent: Intent)

    fun installedApps(destination: NavigationDestination): List<InstalledNavigationApp> =
        resolveTargets(destination).map {
            InstalledNavigationApp(it.info.activityInfo.packageName, it.info.loadLabel(packageManager).toString(), it.provider)
        }

    @MainThread
    fun showChooser(context: Context, destination: NavigationDestination, title: String): ExternalActionResult {
        // Re-query at the moment of use: a previously discovered app might have been uninstalled.
        val targets = resolveTargets(destination)
        if (targets.isEmpty()) return ExternalActionResult.NoNavigationApp(urls.webFallback(destination))
        val chooser = createNavigationChooser(targets.map { it.intent }, title)
        return if (launch(context, chooser)) ExternalActionResult.Opened
        else ExternalActionResult.NoNavigationApp(urls.webFallback(destination))
    }

    /** Only call after the user presses the no-app UI's "Open map website" button. */
    @MainThread
    fun openWebFallback(context: Context, destination: NavigationDestination, title: String): ExternalActionResult {
        val view = Intent(Intent.ACTION_VIEW, Uri.parse(urls.webFallback(destination))).addCategory(Intent.CATEGORY_BROWSABLE)
        val chooser = Intent.createChooser(view, title).apply { disallowSingleChoiceAutoLaunch() }
        return if (launch(context, chooser)) ExternalActionResult.Opened else ExternalActionResult.Unavailable
    }

    private fun resolveTargets(destination: NavigationDestination): List<Target> {
        val targets = linkedMapOf<String, Target>()
        // Prefer each app's documented native route endpoint over a duplicate generic geo handler.
        for (provider in listOf(NavigationProvider.AMAP, NavigationProvider.BAIDU, NavigationProvider.TENCENT, NavigationProvider.GOOGLE)) {
            val uri = urls.native(provider, destination, tencentDeveloperKey) ?: continue
            val request = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(provider.packageName)
            for (info in query(request)) {
                val activity = info.activityInfo
                if (activity.packageName != provider.packageName) continue
                targets.putIfAbsent(activity.packageName, Target(provider, info, Intent(request).setComponent(
                    ComponentName(activity.packageName, activity.name),
                )))
            }
        }
        val generic = Intent(Intent.ACTION_VIEW, Uri.parse(urls.generic(destination)))
        for (info in query(generic)) {
            val activity = info.activityInfo
            // Includes compatible OSM clients (e.g. Organic Maps/OsmAnd), without a hard-coded install assumption.
            targets.putIfAbsent(activity.packageName, Target(NavigationProvider.GENERIC, info, Intent(generic).setComponent(
                ComponentName(activity.packageName, activity.name),
            )))
        }
        return targets.values.sortedWith(compareBy<Target>({ it.info.loadLabel(packageManager).toString().lowercase() }, { it.info.activityInfo.packageName }))
    }

    private fun query(intent: Intent): List<ResolveInfo> = runCatching {
        val matches = if (Build.VERSION.SDK_INT >= 33) {
            packageManager.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()))
        } else {
            @Suppress("DEPRECATION")
            packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        }
        matches.filter { match ->
            val info = match.activityInfo
            info != null && info.exported && info.enabled && info.applicationInfo.enabled &&
                info.packageName != appContext.packageName &&
                (info.permission == null || appContext.checkSelfPermission(info.permission) == PackageManager.PERMISSION_GRANTED)
        }
    }.getOrDefault(emptyList())
}

/** Native Android Sharesheet with a canonical public point link and no private/account state. */
object PlaceSharing {
    @MainThread
    fun share(context: Context, markerId: Long, title: String, language: String? = null): ExternalActionResult {
        val url = PlaceLink.shareUrl(markerId, language)
        val label = title.filterNot { it.isISOControl() }.trim().take(256)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, if (label.isEmpty()) url else "$label\n$url")
            putExtra(Intent.EXTRA_SUBJECT, label)
            putExtra(Intent.EXTRA_TITLE, label)
        }
        return if (launch(context, Intent.createChooser(send, null))) ExternalActionResult.Opened else ExternalActionResult.Unavailable
    }
}

internal fun createNavigationChooser(intents: List<Intent>, title: String): Intent {
    require(intents.isNotEmpty() && intents.all { it.component != null })
    return Intent.createChooser(intents.first(), title).apply {
        // EXTRA_INITIAL_INTENTS is capped at two additional apps on Android 10+. Alternate intents
        // are resolved as peers; explicit components and package deduplication avoid duplicate rows.
        if (intents.size > 1) putExtra(Intent.EXTRA_ALTERNATE_INTENTS, intents.drop(1).toTypedArray())
        disallowSingleChoiceAutoLaunch()
    }
}

private fun Intent.disallowSingleChoiceAutoLaunch() {
    if (Build.VERSION.SDK_INT >= 29) putExtra(Intent.EXTRA_AUTO_LAUNCH_SINGLE_CHOICE, false)
}

private fun launch(context: Context, intent: Intent): Boolean = try {
    if (!context.hasActivity()) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    true
} catch (_: ActivityNotFoundException) {
    false
} catch (_: SecurityException) {
    false
}

private fun Context.hasActivity(): Boolean {
    var current = this
    val visited = mutableSetOf<Context>()
    while (visited.add(current)) {
        if (current is Activity) return true
        if (current !is ContextWrapper) return false
        current = current.baseContext
    }
    return false
}
