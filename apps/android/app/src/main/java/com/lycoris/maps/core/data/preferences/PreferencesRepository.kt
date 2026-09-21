package com.lycoris.maps.core.data.preferences

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.lycoris.maps.core.model.Language
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import java.io.IOException
import java.util.Locale

private val Context.lycorisPreferences by preferencesDataStore("lycoris_settings")
data class Preferences(val language: Language = if (Locale.getDefault().language == "zh") Language.ZH else Language.EN, val radiusMeters: Int = 1000, val mapSource: MapSource = MapSource.OSM, val searchType: SearchType = SearchType.ALL, val tencentPrivacyAccepted: Boolean = false, val initialized: Boolean = false)

class PreferencesRepository(context: Context, scope: CoroutineScope, tiandituAvailable: Boolean, googleAvailable: Boolean = false, tencentAvailable: Boolean = false) {
    private val store = context.applicationContext.lycorisPreferences
    private val available = buildSet {
        add(MapSource.OSM)
        if (tiandituAvailable) add(MapSource.TIANDITU)
        if (googleAvailable) add(MapSource.GOOGLE)
        if (tencentAvailable) add(MapSource.TENCENT)
    }
    private val initial = Preferences().let { it.copy(mapSource = resolveMapSource(null, it.language, available)) }
    private val language = stringPreferencesKey("language")
    private val radius = intPreferencesKey("radius_meters")
    private val source = stringPreferencesKey("map_source")
    private val searchType = stringPreferencesKey("search_type")
    private val tencentPrivacy = booleanPreferencesKey("tencent_map_privacy_v1")
    val state = store.data.catch { if (it is IOException) emit(emptyPreferences()) else throw it }.map { values ->
        val selectedLanguage = Language.entries.firstOrNull { it.tag == values[language] } ?: initial.language
        Preferences(
            selectedLanguage,
            values[radius]?.takeIf { it in 1..50000 } ?: 1000,
            resolveMapSource(values[source], selectedLanguage, available),
            SearchType.fromStored(values[searchType]),
            values[tencentPrivacy] == true,
            true,
        )
    }.stateIn(scope, SharingStarted.Eagerly, initial)

    suspend fun setLanguage(value: Language) { store.edit { it[language] = value.tag } }
    suspend fun setSearchType(value: SearchType) { store.edit { it[searchType] = value.storedValue } }
    suspend fun acceptTencentPrivacy() { store.edit { it[tencentPrivacy] = true } }
    suspend fun setRadius(value: Int) { require(value in 1..50000); store.edit { it[radius] = value } }
    suspend fun setMapSource(value: MapSource) {
        require(value in available)
        store.edit { it[source] = value.name }
    }
}

fun parseRadius(value: String): Int? = value.trim().takeIf { it.isNotEmpty() && it.all(Char::isDigit) }
    ?.toIntOrNull()?.takeIf { it in 1..50000 }
