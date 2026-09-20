package com.lycoris.maps.app

import android.content.Context
import com.lycoris.maps.core.data.drafts.*
import com.lycoris.maps.core.media.PhotoImporter
import com.lycoris.maps.feature.contributions.*
import com.lycoris.maps.BuildConfig
import com.lycoris.maps.core.data.AccountRepository
import com.lycoris.maps.core.data.preferences.PreferencesRepository
import com.lycoris.maps.core.network.ApiClients
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class AppContainer(context: Context) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val clients = ApiClients.create(context, BuildConfig.API_BASE_URL,
        "LycorisAndroid/${BuildConfig.VERSION_NAME} (+https://lycoris-map.com)", BuildConfig.TEST_ENVIRONMENT)
    val accounts = AccountRepository(clients, scope)
    val googleMapsAvailability = com.lycoris.maps.core.map.GoogleMapsAvailability.check(context)
    val preferences = PreferencesRepository(context, scope, tiandituAvailable = false,
        googleAvailable = googleMapsAvailability == com.lycoris.maps.core.map.GoogleMapsAvailability.AVAILABLE,
        tencentAvailable = BuildConfig.TENCENT_MAPS_CONFIGURED)
    private val database = ContributionDatabase.open(context)
    private val drafts = RoomDraftStore(database.drafts())
    private val locks = DraftLocks()
    private val photos = PhotoImporter(context)
    val contributionEngine = ContributionEngine(drafts, locks, AccountContributionTransport(accounts), photos.files)
    val contributions = ContributionCoordinator(accounts, drafts, locks, photos, contributionEngine, WorkContributionScheduler(context), scope)
    init { scope.launch { accounts.restore() } }
}
