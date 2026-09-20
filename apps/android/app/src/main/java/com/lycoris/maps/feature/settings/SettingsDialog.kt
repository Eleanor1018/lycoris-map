package com.lycoris.maps.feature.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.lycoris.maps.core.data.preferences.Preferences
import com.lycoris.maps.core.data.preferences.MapSource
import com.lycoris.maps.core.data.preferences.SearchType
import com.lycoris.maps.BuildConfig
import com.lycoris.maps.core.map.GoogleMapsAvailability
import com.lycoris.maps.core.data.preferences.parseRadius
import com.lycoris.maps.core.model.Language

@Composable
fun SettingsDialog(kind: String, preferences: Preferences, onDismiss: () -> Unit, onLanguage: (Language) -> Unit, onRadius: (Int) -> Unit,
    onMapSource: (MapSource) -> Unit = {},
    googleAvailability: GoogleMapsAvailability = GoogleMapsAvailability.NOT_CONFIGURED,
    onSearchType: (SearchType) -> Unit = {},
) {
    val zh = preferences.language == Language.ZH
    when (kind) {
        "language" -> AlertDialog(onDismissRequest = onDismiss, confirmButton = {}, dismissButton = {
            TextButton(onDismiss) { Text(if (zh) "取消" else "Cancel") }
        }, text = {
            Column {
                Language.entries.forEach { language ->
                    Row(Modifier.fillMaxWidth().selectable(preferences.language == language, role = Role.RadioButton, onClick = { onLanguage(language); onDismiss() }).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(preferences.language == language, onClick = null)
                        Text(if (language == Language.ZH) "简体中文" else "English", Modifier.padding(12.dp))
                    }
                }
            }
        })
        "searchType" -> AlertDialog(onDismissRequest = onDismiss,
            title = { Text(if (zh) "搜索类型" else "Search Type") },
            confirmButton = { TextButton(onDismiss) { Text(if (zh) "完成" else "Done") } }, text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    SearchType.entries.forEach { type ->
                        val selected = preferences.searchType == type
                        Row(Modifier.fillMaxWidth().selectable(selected, role = Role.RadioButton,
                            onClick = { onSearchType(type); onDismiss() }).padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected, onClick = null)
                            Text(type.title(preferences.language), Modifier.padding(12.dp))
                        }
                    }
                }
            })
        "about" -> AlertDialog(onDismissRequest = onDismiss,
            title = { Text(if (zh) "关于 Lycoris Maps" else "About Lycoris Maps") },
            confirmButton = { TextButton(onDismiss) { Text(if (zh) "完成" else "Done") } }, text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Lycoris Maps", Modifier.weight(1f))
                        Text(BuildConfig.VERSION_NAME)
                    }
                    Text(if (zh) "一款简洁的地图，帮你找到无障碍卫生间、母婴室和医疗机构。"
                        else "A simple map for finding accessible toilets, nursing rooms, and medical institutions.")
                    Text(if (zh) "Lycoris 分享链接可在 App 中打开点位，是否可见取决于你的访问权限。"
                        else "Shared Lycoris links can open places in the app. Place availability depends on your access.")
                }
            })
        "range" -> {
            var input by rememberSaveable { mutableStateOf(preferences.radiusMeters.toString()) }
            val parsed = parseRadius(input)
            AlertDialog(onDismissRequest = onDismiss, title = { Text(if (zh) "搜索范围" else "Search range") }, text = {
                OutlinedTextField(input, { input = it }, singleLine = true, suffix = { Text("m") },
                    label = { Text(if (zh) "距离" else "Distance") }, isError = parsed == null,
                    supportingText = { Text("1–50,000 m") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            }, confirmButton = { TextButton({ parsed?.let(onRadius); onDismiss() }, enabled = parsed != null) { Text(if (zh) "完成" else "Done") } },
                dismissButton = { TextButton(onDismiss) { Text(if (zh) "取消" else "Cancel") } })
        }
        "source" -> AlertDialog(onDismissRequest = onDismiss, confirmButton = { TextButton(onDismiss) { Text(if (zh) "完成" else "Done") } }, text = {
            Column {
                listOf(MapSource.OSM to "OpenStreetMap", MapSource.GOOGLE to "Google Maps").forEach { (source, label) ->
                    val enabled = source == MapSource.OSM || googleAvailability == GoogleMapsAvailability.AVAILABLE
                    val selected = preferences.mapSource == source
                    Row(Modifier.fillMaxWidth().selectable(selected, enabled = enabled, role = Role.RadioButton,
                        onClick = { onMapSource(source); onDismiss() }).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected, null, enabled = enabled)
                        Text(label, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else 0.38f))
                    }
                }
                when (googleAvailability) {
                    GoogleMapsAvailability.NOT_CONFIGURED -> Text(if (zh) "Google Maps 暂未配置。" else "Google Maps is not configured yet.", style = MaterialTheme.typography.bodySmall)
                    GoogleMapsAvailability.PLAY_SERVICES_UNAVAILABLE -> Text(if (zh) "此设备的 Google Play 服务不可用。" else "Google Play services are unavailable on this device.", style = MaterialTheme.typography.bodySmall)
                    GoogleMapsAvailability.AVAILABLE -> Unit
                }
            }
        })
    }
}
