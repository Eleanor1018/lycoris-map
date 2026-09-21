package com.lycoris.maps.feature.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import com.lycoris.maps.core.model.Language

/** The SDK's privacy flag must reflect a real choice, including for language defaults. */
@Composable
fun TencentPrivacyDialog(language: Language, onAccept: () -> Unit, onUseOsm: () -> Unit, onOpenPrivacy: () -> Unit) {
    val zh = language == Language.ZH
    AlertDialog(onDismissRequest = onUseOsm,
        title = { Text(if (zh) "使用腾讯地图" else "Use Tencent Maps") },
        text = { Column {
            Text(if (zh) "腾讯地图 SDK 会处理设备、网络及地图浏览信息以提供底图。请阅读隐私政策后选择是否使用；你也可以继续使用 OSM。"
                else "Tencent Maps SDK processes device, network and map-viewing information to provide the map. Read its privacy policy before continuing, or keep using OSM.")
            TextButton(onOpenPrivacy) { Text(if (zh) "腾讯位置服务隐私政策" else "Tencent Location Services privacy policy") }
        } },
        confirmButton = { TextButton(onAccept) { Text(if (zh) "同意并继续" else "Agree and continue") } },
        dismissButton = { TextButton(onUseOsm) { Text(if (zh) "使用 OSM" else "Use OSM") } })
}
