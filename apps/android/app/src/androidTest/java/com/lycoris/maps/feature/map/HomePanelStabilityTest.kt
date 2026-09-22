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
        val closeCalls = java.util.concurrent.atomic.AtomicInteger(0)
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
                            onCloseSecondary = { closeCalls.incrementAndGet(); nearby.value = false },
                            mapLayers = { Text("Map update ${mapTick.intValue}") },
                            panelContent = {
                                if (nearby.value) {
                                    // Production Nearby shows a selected-category/radius subtitle row
                                    // followed by the results, not the category cards again.
                                    item("nearby-subtitle") { Text("Nursing Rooms · 1km", Modifier.padding(horizontal = 30.dp, vertical = 11.dp)) }
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
        repeat(2) { cycle ->
            // The real click target must be scrolled into view and shown before clicking; the
            // fixture density is forced, so a smaller CI pixel window can hide it otherwise.
            compose.onNodeWithText("Nursing Rooms").performScrollTo().assertIsDisplayed().performClick()
            compose.waitForIdle()
            assertTrue(
                "Nursing Rooms click did not enter Nearby; cycle=$cycle selected=$selected " +
                    "closeCalls=${closeCalls.get()}",
                selected.size == cycle + 1 && nearby.value,
            )
            for (count in listOf(-1, 0, 8, 0)) {
                compose.runOnIdle { resultCount.intValue = count }
                compose.waitForIdle()
                // Distinguish an accidental close from a semantics-tree timing gap: the state must
                // still be open after each content change, before any near-by lookup.
                assertTrue(
                    "Nearby was closed unexpectedly; cycle=$cycle count=$count selected=$selected " +
                        "closeCalls=${closeCalls.get()}",
                    nearby.value,
                )
                val expected = nearbyBounds(cycle, count, selected, closeCalls.get())
                repeat(12) {
                    compose.runOnIdle { mapTick.intValue++ }
                    compose.mainClock.advanceTimeByFrame()
                    compose.waitForIdle()
                    val actual = nearbyBounds(cycle, count, selected, closeCalls.get())
                    assertEquals(
                        "Nearby must stop moving after content has settled; cycle=$cycle count=$count " +
                            "selected=$selected closeCalls=${closeCalls.get()} stateOpen=${nearby.value}",
                        expected.top, actual.top, 1f,
                    )
                    assertEquals(expected.bottom, actual.bottom, 1f)
                    compose.onNodeWithText("Nearby").assertIsDisplayed()
                }
            }
            compose.onNodeWithText("Nearby").performScrollTo()
            // Scroll the real close target into the viewport and prove it is visible before clicking,
            // then record the target and root bounds so a failure shows whether the click landed.
            val closeButton = compose.onNodeWithContentDescription("Close")
            val closeBounds = try {
                closeButton.performScrollTo().assertIsDisplayed()
                closeButton.fetchSemanticsNode().boundsInRoot
            } catch (failure: AssertionError) {
                throw AssertionError(
                    "Close button was not reachable in the viewport; cycle=$cycle selected=$selected " +
                        "closeCalls=${closeCalls.get()}: ${failure.message}",
                    failure,
                )
            }
            val rootBounds = compose.onRoot().fetchSemanticsNode().boundsInRoot
            closeButton.performClick()
            compose.waitForIdle()
            // Verify the close actually took effect before checking the returned main menu. Under the
            // forced large-font density a title can sit outside the scroll viewport, so the returned
            // heading is scrolled to rather than treated as an immediate on-screen presence failure.
            assertFalse(
                "Close did not leave Nearby; cycle=$cycle selected=$selected closeCalls=${closeCalls.get()} " +
                    "closeBounds=$closeBounds rootBounds=$rootBounds",
                nearby.value,
            )
            assertEquals(cycle + 1, closeCalls.get())
            compose.onNodeWithText("Find Nearby").performScrollTo().assertIsDisplayed()
        }
        assertEquals(listOf("baby_room", "baby_room"), selected)
    }

    private fun nearbyBounds(cycle: Int, count: Int, selected: List<String>, closeCalls: Int): Rect {
        val interaction = compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, "NEARBY"))
        return try {
            interaction.fetchSemanticsNode().boundsInRoot
        } catch (failure: AssertionError) {
            // Keep the original assertExists-style failure but explain the surrounding state, so CI
            // can separate an accidental close from a semantics-tree timing gap. No sleep is added.
            throw AssertionError(
                "PaneTitle NEARBY was not found; cycle=$cycle count=$count selected=$selected " +
                    "closeCalls=$closeCalls: ${failure.message}",
                failure,
            )
        }
    }
}
