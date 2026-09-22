package com.lycoris.maps.feature.settings

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.lycoris.maps.core.data.preferences.MapSource
import com.lycoris.maps.core.data.preferences.Preferences
import com.lycoris.maps.core.map.GoogleMapsAvailability
import com.lycoris.maps.core.model.Language
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class MapSourceDialogTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun configuredTiandituCanBeSelectedWithoutGoogleServices() {
        var selected: MapSource? = null
        var dismissed = false
        compose.setContent {
            MaterialTheme { SettingsDialog("source", Preferences(Language.ZH), { dismissed = true }, {}, {},
                onMapSource = { selected = it }, tiandituAvailable = true,
                googleAvailability = GoogleMapsAvailability.PLAY_SERVICES_UNAVAILABLE) }
        }
        compose.onNodeWithText("天地图").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(MapSource.TIANDITU, selected); assertTrue(dismissed) }
    }

    @Test fun unconfiguredTiandituKeepsOsmUsable() {
        compose.setContent {
            MaterialTheme { SettingsDialog("source", Preferences(Language.EN), {}, {}, {}, tiandituAvailable = false) }
        }
        compose.onNodeWithText("Tianditu").assertIsNotEnabled()
        compose.onNodeWithText("OpenStreetMap").assertIsEnabled().assertIsSelected()
    }

    @Test fun configuredTencentCanBeSelectedWithoutGoogleServices() {
        var selected: MapSource? = null
        var dismissed = false
        compose.setContent {
            MaterialTheme { SettingsDialog("source", Preferences(Language.ZH), { dismissed = true }, {}, {},
                onMapSource = { selected = it }, tencentAvailable = true,
                googleAvailability = GoogleMapsAvailability.PLAY_SERVICES_UNAVAILABLE) }
        }
        compose.onNodeWithText("腾讯地图").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(MapSource.TENCENT, selected); assertTrue(dismissed) }
    }

    @Test fun unconfiguredTencentDoesNotOfferAnUnusableChoice() {
        compose.setContent {
            MaterialTheme { SettingsDialog("source", Preferences(Language.EN), {}, {}, {}, tencentAvailable = false) }
        }
        compose.onNodeWithText("Tencent Maps").assertIsNotEnabled()
        compose.onNodeWithText("OpenStreetMap").assertIsEnabled().assertIsSelected()
    }

    @Test fun missingKeyKeepsOsmUsableAndExplainsGoogleAvailability() {
        compose.setContent {
            MaterialTheme { SettingsDialog("source", Preferences(Language.EN), {}, {}, {},
                googleAvailability = GoogleMapsAvailability.NOT_CONFIGURED) }
        }
        compose.onNodeWithText("OpenStreetMap").assertIsEnabled().assertIsSelected()
        compose.onNodeWithText("Google Maps").assertIsNotEnabled()
        compose.onNodeWithText("Google Maps is not configured yet.").assertExists()
    }

    @Test fun deviceWithoutPlayServicesCanStillSelectOsm() {
        var selected: MapSource? = null
        compose.setContent {
            MaterialTheme { SettingsDialog("source", Preferences(Language.EN), {}, {}, {},
                onMapSource = { selected = it }, googleAvailability = GoogleMapsAvailability.PLAY_SERVICES_UNAVAILABLE) }
        }
        compose.onNodeWithText("Google Maps").assertIsNotEnabled()
        compose.onNodeWithText("Google Play services are unavailable on this device.").assertExists()
        compose.onNodeWithText("OpenStreetMap").performClick()
        compose.runOnIdle { assertEquals(MapSource.OSM, selected) }
    }

    @Test fun availableGoogleChoiceSwitchesProviderAndClosesTheDialog() {
        var selected: MapSource? = null
        var dismissed = false
        compose.setContent {
            MaterialTheme { SettingsDialog("source", Preferences(Language.EN), { dismissed = true }, {}, {},
                onMapSource = { selected = it }, googleAvailability = GoogleMapsAvailability.AVAILABLE) }
        }
        compose.onNodeWithText("Google Maps").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(MapSource.GOOGLE, selected); assertTrue(dismissed) }
    }
}
