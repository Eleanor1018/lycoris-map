package com.lycoris.maps.feature.map

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.lycoris.maps.core.designsystem.LycorisTheme
import com.lycoris.maps.core.map.NativeMapState
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Synthetic Nearby content and map updates; no account, location or backend writes. */
class HomePanelStabilityTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun nearbyLoadingEmptyAndLongResultsSettleWithFractionalDensity() {
        val nearby = mutableStateOf(false)
        val resultCount = mutableIntStateOf(-1)
        val mapTick = mutableIntStateOf(0)
        val selected = mutableListOf<String>()
        val map = NativeMapState()
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(2.625f, fontScale = 1.3f)) {
                LycorisTheme {
                    Box(Modifier.width(360.dp).height(640.dp)) {
                        HomeScreen(map, false, MainSection.EXPLORE, {}, "", {}, {}, {}, {}, {}, {},
                            onNearby = { category -> selected.add(requireNotNull(category)); nearby.value = true },
                            onContribute = {}, onMapSource = {}, onSetting = {}, radius = 1000,
                            mapSourceName = "OSM", secondaryTitle = if (nearby.value) "Nearby" else null,
                            secondaryKey = if (nearby.value) "NEARBY" else null,
                            onCloseSecondary = { nearby.value = false },
                            mapLayers = { Text("Map update ${mapTick.intValue}") },
                            panelContent = {
                                if (nearby.value) {
                                    item("categories") { NearbyCategories(false, {}) }
                                    when (resultCount.intValue) {
                                        -1 -> item("loading") { Text("Loading nearby places") }
                                        0 -> item("empty") { Text("No places in this area") }
                                        else -> items(resultCount.intValue, key = { "place-$it" }) {
                                            Text("Nearby place $it", Modifier.fillMaxWidth().height(80.dp))
                                        }
                                    }
                                } else {
                                    items(20, key = { "position-$it" }) { Text("Position $it", Modifier.height(60.dp)) }
                                }
                            })
                    }
                }
            }
        }
        repeat(2) {
            compose.onNodeWithText("Nursing Rooms").performClick()
            for (count in listOf(-1, 0, 8, 0)) {
                compose.runOnIdle { resultCount.intValue = count }
                compose.waitForIdle()
                val expected = nearbyBounds()
                repeat(12) {
                    compose.runOnIdle { mapTick.intValue++ }
                    compose.mainClock.advanceTimeByFrame()
                    compose.waitForIdle()
                    val actual = nearbyBounds()
                    assertEquals("Nearby must stop moving after content has settled", expected.top, actual.top, 1f)
                    assertEquals(expected.bottom, actual.bottom, 1f)
                    compose.onNodeWithText("Nearby").assertIsDisplayed()
                }
            }
            compose.onNodeWithText("Nearby").performScrollTo()
            compose.onNodeWithContentDescription("Close").performClick()
            compose.onNodeWithText("Find Nearby").assertIsDisplayed()
        }
        assertEquals(listOf("baby_room", "baby_room"), selected)
    }

    private fun nearbyBounds(): Rect = compose.onNode(
        SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, "NEARBY"),
    ).fetchSemanticsNode().boundsInRoot
}
