package com.lycoris.maps.feature.settings

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import com.lycoris.maps.R
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
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
    tencentAvailable: Boolean = BuildConfig.TENCENT_MAPS_CONFIGURED,
    tiandituAvailable: Boolean = BuildConfig.TIANDITU_MAPS_CONFIGURED,
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
        "about" -> AboutDialog(zh = zh, onDismiss = onDismiss)
        "range" -> {
            var input by rememberSaveable { mutableStateOf(preferences.radiusMeters.toString()) }
            val parsed = parseRadius(input)
            // The dialog's own focus manager/keyboard are only available inside the AlertDialog
            // content composition (the dialog window), not from this outer function body. The
            // content registers a dismiss callback here; every close path calls it before onDismiss.
            val dismissInput = remember { mutableStateOf<(() -> Unit)?>(null) }
            val close = {
                dismissInput.value?.invoke()
                onDismiss()
            }
            AlertDialog(onDismissRequest = close, title = { Text(if (zh) "搜索范围" else "Search range") }, text = {
                val dialogFocus = LocalFocusManager.current
                val dialogKeyboard = LocalSoftwareKeyboardController.current
                DisposableEffect(dialogFocus, dialogKeyboard) {
                    dismissInput.value = {
                        dialogFocus.clearFocus(force = true)
                        dialogKeyboard?.hide()
                    }
                    onDispose { dismissInput.value = null }
                }
                OutlinedTextField(input, { input = it }, singleLine = true, suffix = { Text("m") },
                    label = { Text(if (zh) "距离" else "Distance") }, isError = parsed == null,
                    supportingText = { Text("1–50,000 m") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            }, confirmButton = { TextButton({ parsed?.let(onRadius); close() }, enabled = parsed != null) { Text(if (zh) "完成" else "Done") } },
                dismissButton = { TextButton(close) { Text(if (zh) "取消" else "Cancel") } })
        }
        "source" -> AlertDialog(onDismissRequest = onDismiss, confirmButton = { TextButton(onDismiss) { Text(if (zh) "完成" else "Done") } }, text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                listOf(MapSource.OSM to "OpenStreetMap", MapSource.TENCENT to MapSource.TENCENT.title(preferences.language),
                    MapSource.TIANDITU to MapSource.TIANDITU.title(preferences.language), MapSource.GOOGLE to "Google Maps").forEach { (source, label) ->
                    val enabled = when (source) {
                        MapSource.OSM -> true
                        MapSource.TENCENT -> tencentAvailable
                        MapSource.TIANDITU -> tiandituAvailable
                        MapSource.GOOGLE -> googleAvailability == GoogleMapsAvailability.AVAILABLE
                    }
                    val selected = preferences.mapSource == source
                    Row(Modifier.fillMaxWidth().selectable(selected, enabled = enabled, role = Role.RadioButton,
                        onClick = { onMapSource(source); onDismiss() }).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected, null, enabled = enabled)
                        Text(label, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else 0.38f))
                    }
                }
                if (!tencentAvailable) Text(if (zh) "腾讯地图暂未配置。" else "Tencent Maps is not configured yet.", style = MaterialTheme.typography.bodySmall)
                if (!tiandituAvailable) Text(if (zh) "天地图暂未配置。" else "Tianditu is not configured yet.", style = MaterialTheme.typography.bodySmall)
                when (googleAvailability) {
                    GoogleMapsAvailability.NOT_CONFIGURED -> Text(if (zh) "Google Maps 暂未配置。" else "Google Maps is not configured yet.", style = MaterialTheme.typography.bodySmall)
                    GoogleMapsAvailability.PLAY_SERVICES_UNAVAILABLE -> Text(if (zh) "此设备的 Google Play 服务不可用。" else "Google Play services are unavailable on this device.", style = MaterialTheme.typography.bodySmall)
                    GoogleMapsAvailability.AVAILABLE -> Unit
                }
            }
        })
    }
}


private const val REPOSITORY_URL = "https://github.com/Project-Lycoris/lycoris-map"

@Composable
private fun AboutDialog(zh: Boolean, onDismiss: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    var linkFailed by remember { mutableStateOf(false) }
    val openRepository = {
        linkFailed = false
        try {
            uriHandler.openUri(REPOSITORY_URL)
        } catch (_: IllegalArgumentException) {
            linkFailed = true
        } catch (_: SecurityException) {
            linkFailed = true
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onDismiss) { Text(if (zh) "完成" else "Done") } },
        text = {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(11.dp),
            ) {
                Image(painterResource(R.drawable.lycoris_mark), contentDescription = null,
                    modifier = Modifier.size(72.dp).clip(RoundedCornerShape(18.dp)))
                Text("Lycoris Maps", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                Text((if (zh) "版本 " else "Version ") + BuildConfig.VERSION_NAME,
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(if (zh) "一起跨越山与海" else "Across mountains and seas, together.",
                    Modifier.padding(top = 11.dp), style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary, textAlign = TextAlign.Center)
                Text(if (zh) "一款简洁的地图，帮你找到无障碍卫生间、母婴室和医疗机构。"
                    else "A simple map for finding accessible toilets, nursing rooms, and medical institutions.",
                    textAlign = TextAlign.Center)
                Button(onClick = openRepository, modifier = Modifier.fillMaxWidth().padding(top = 11.dp)) {
                    Text(if (zh) "访问 GitHub 仓库" else "View on GitHub", textAlign = TextAlign.Center)
                }
                TextButton(onClick = openRepository) {
                    Text("github.com/Project-Lycoris/lycoris-map", style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.Center)
                }
                if (linkFailed) Text(if (zh) "无法打开链接，请在浏览器中访问上述地址。"
                    else "Could not open the link. Visit the address above in your browser.",
                    color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
                Text(if (zh) "感谢所有贡献者。" else "Thank you to all our contributors.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center)
            }
        },
    )
}
