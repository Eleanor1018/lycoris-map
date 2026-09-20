package com.lycoris.maps.feature.map

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import com.lycoris.maps.core.designsystem.LycorisTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class MapPanelTest {
    @get:Rule val compose = createComposeRule()

    @Test fun middleShowsNearbyAndCanExpandToReachLastRow() {
        compose.setContent {
            LycorisTheme {
                BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                    val density = LocalDensity.current
                    var stop by remember { mutableStateOf(PanelStop.MIDDLE) }
                    MapPanel(with(density) { maxHeight.toPx() }, with(density) { 284.dp.toPx() }, stop, "Explore", { stop = it }, {}, Modifier.testTag("sheet")) {
                        item("nearby") { NearbyCategories(false, {}) }
                        items(25, key = { "position-$it" }) { Text("Position $it", Modifier.fillMaxWidth().height(48.dp)) }
                    }
                }
            }
        }
        compose.onNodeWithText("Accessible Toilets").assertIsDisplayed()
        compose.onNodeWithText("Medical Institutions").assertIsDisplayed()
        compose.onNodeWithTag("sheet").performSemanticsAction(SemanticsActions.Expand) { it() }
        compose.onNodeWithTag("panel-list").performScrollToIndex(25)
        compose.onNodeWithText("Position 24").assertIsDisplayed()
    }

    @Test fun draggingSecondaryAllTheWayDownUsesCloseTransition() {
        val closed = java.util.concurrent.atomic.AtomicBoolean(false)
        val visible = java.util.concurrent.atomic.AtomicReference(0f)
        val stops = java.util.Collections.synchronizedList(mutableListOf<PanelStop>())
        compose.setContent {
            LycorisTheme {
                BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                    val density = LocalDensity.current
                    var stop by remember { mutableStateOf(PanelStop.MIDDLE) }
                    MapPanel(with(density) { maxHeight.toPx() }, with(density) { 284.dp.toPx() }, stop, "Nearby", {
                        stop = it
                        stops.add(it)
                        if (it == PanelStop.COLLAPSED) closed.set(true)
                    }, { visible.set(it) }, Modifier.testTag("sheet")) {
                        items(20, key = { it }) { Text("Nearby $it", Modifier.height(48.dp)) }
                    }
                }
            }
        }
        compose.onNodeWithTag("panel-grabber").assertIsDisplayed()
        val before = visible.get()
        compose.onNodeWithTag("panel-grabber").performTouchInput { swipe(center, center.copy(y = center.y + 400f), 450) }
        compose.waitForIdle()
        assertTrue("Dragging must close the sheet; stops=$stops, heightBefore=$before, heightAfter=${visible.get()}", closed.get())
    }

    @Test fun noImageDetailMeasuresItsContentInsteadOfScreenHeight() {
        var visible = 0f
        var expected = 0f
        compose.setContent {
            LycorisTheme {
                BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                    val density = LocalDensity.current
                    expected = with(density) { 212.dp.toPx() }
                    MapPanel(with(density) { maxHeight.toPx() }, with(density) { 284.dp.toPx() }, PanelStop.EXPANDED, "Detail", {}, { visible = it }) {
                        item { Box(Modifier.fillMaxWidth().height(200.dp)) }
                    }
                }
            }
        }
        compose.waitUntil(5_000) { kotlin.math.abs(visible - expected) < 2f }
        compose.runOnIdle { assertEquals(expected, visible, 2f) }
    }

    @Test fun fiveThousandRowsComposeOnlyNearTheViewportAndLastRowIsReachable() {
        val active = java.util.concurrent.ConcurrentHashMap.newKeySet<Int>()
        val entered = java.util.concurrent.ConcurrentHashMap.newKeySet<Int>()
        val peak = java.util.concurrent.atomic.AtomicInteger(0)
        compose.setContent {
            LycorisTheme {
                BoxWithConstraints(Modifier.fillMaxWidth().height(400.dp), contentAlignment = Alignment.BottomCenter) {
                    val density = LocalDensity.current
                    var stop by remember { mutableStateOf(PanelStop.MIDDLE) }
                    MapPanel(with(density) { maxHeight.toPx() }, with(density) { 220.dp.toPx() }, stop,
                        "Large list", { stop = it }, {}, Modifier.testTag("sheet")) {
                        items(5_000, key = { "synthetic-place-$it" }, contentType = { "place" }) { index ->
                            DisposableEffect(index) {
                                active.add(index)
                                entered.add(index)
                                peak.accumulateAndGet(active.size, ::maxOf)
                                onDispose { active.remove(index) }
                            }
                            Text("Synthetic place $index", Modifier.fillMaxWidth().height(48.dp))
                        }
                    }
                }
            }
        }
        compose.onNodeWithText("Synthetic place 0").assertIsDisplayed()
        compose.runOnIdle {
            assertTrue("A 400dp viewport must not eagerly compose 5,000 rows: ${entered.size}", entered.size in 1..40)
        }
        compose.onNodeWithTag("sheet").performSemanticsAction(SemanticsActions.Expand) { it() }
        compose.onNodeWithTag("panel-list").performScrollToIndex(4_999)
        compose.onNodeWithText("Synthetic place 4999").assertIsDisplayed()
        compose.runOnIdle {
            assertTrue("Offscreen rows must leave the active composition: ${active.size}", active.size in 1..40)
            assertTrue("Jumping to the last row must not compose intermediate rows: ${entered.size}", entered.size < 100)
            assertTrue("Only nearby viewport generations may coexist: ${peak.get()}", peak.get() <= 40)
        }
    }
}
