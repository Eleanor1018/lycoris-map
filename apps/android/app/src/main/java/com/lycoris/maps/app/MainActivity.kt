package com.lycoris.maps.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.lycoris.maps.core.designsystem.LycorisTheme
import com.lycoris.maps.core.platform.PlaceLink
import com.lycoris.maps.feature.map.HomeViewModel

class MainActivity : ComponentActivity() {
    private val home: HomeViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) openPlace(intent)
        setContent { LycorisTheme { LycorisRoot(home) } }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openPlace(intent)
    }
    private fun openPlace(intent: Intent?) {
        if (intent?.action == Intent.ACTION_VIEW) PlaceLink.parse(intent.dataString)?.let { home.detail(it.markerId) }
    }
}
