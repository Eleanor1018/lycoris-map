package com.lycoris.maps.feature.settings

import androidx.compose.foundation.layout.*
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
import com.lycoris.maps.core.data.preferences.parseRadius
import com.lycoris.maps.core.model.Language

@Composable
fun SettingsDialog(kind: String, preferences: Preferences, onDismiss: () -> Unit, onLanguage: (Language) -> Unit, onRadius: (Int) -> Unit) {
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
                Row(verticalAlignment = Alignment.CenterVertically) { RadioButton(true, null); Text("OpenStreetMap", Modifier.padding(12.dp)) }
                Text(if (zh) "天地图需要原生客户端授权，暂未启用。" else "Tianditu requires native-client authorization and is not enabled yet.", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                Text("© OpenStreetMap contributors · MapLibre Native", style = MaterialTheme.typography.bodySmall)
            }
        })
    }
}
