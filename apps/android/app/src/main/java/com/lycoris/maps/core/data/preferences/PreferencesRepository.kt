package com.lycoris.maps.core.data.preferences

import android.content.Context
import androidx.datastore.preferences.core.edit
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
enum class MapSource { OSM, TIANDITU }
data class Preferences(val language: Language = if (Locale.getDefault().language == "zh") Language.ZH else Language.EN, val radiusMeters: Int = 1000, val mapSource: MapSource = MapSource.OSM)

class PreferencesRepository(context: Context, scope: CoroutineScope, private val tiandituAvailable: Boolean) {
    private val store = context.applicationContext.lycorisPreferences
    private val language = stringPreferencesKey("language")
    private val radius = intPreferencesKey("radius_meters")
    private val source = stringPreferencesKey("map_source")
    val state = store.data.catch { if (it is IOException) emit(emptyPreferences()) else throw it }.map { values ->
        Preferences(
            Language.entries.firstOrNull { it.tag == values[language] } ?: Preferences().language,
            values[radius]?.takeIf { it in 1..50000 } ?: 1000,
            if (tiandituAvailable && values[source] == MapSource.TIANDITU.name) MapSource.TIANDITU else MapSource.OSM,
        )
    }.stateIn(scope, SharingStarted.Eagerly, Preferences())

    suspend fun setLanguage(value: Language) { store.edit { it[language] = value.tag } }
    suspend fun setRadius(value: Int) { require(value in 1..50000); store.edit { it[radius] = value } }
    suspend fun setMapSource(value: MapSource) {
        require(value == MapSource.OSM || tiandituAvailable)
        store.edit { it[source] = value.name }
    }
}

fun parseRadius(value: String): Int? = value.trim().takeIf { it.isNotEmpty() && it.all(Char::isDigit) }
    ?.toIntOrNull()?.takeIf { it in 1..50000 }
