package com.lycoris.maps.feature.map

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.lycoris.maps.core.designsystem.LycorisTheme
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Layout constraints model small/IME-sized windows; these do not claim system IME or rotation tests. */
class PanelAdaptationTest {
    @get:Rule val compose = createComposeRule()

    @Test fun downwardFlingWithinScrolledContentDoesNotCollapseExpandedSheet() {
        val stop = AtomicReference(PanelStop.MIDDLE)
        scrollingSheet(stop)
        expand()
        compose.onNodeWithTag("panel-list").performScrollToIndex(80)
        compose.onNodeWithText("Row 80").assertIsDisplayed()
        val before = scrollOffset()
        assertTrue(before > 0f)
        compose.onNode(hasScrollAction()).performTouchInput {
            swipe(Offset(center.x, center.y - 100f), Offset(center.x, center.y + 100f), 200)
        }
        compose.waitForIdle()
        val after = scrollOffset()
        assertTrue("The list should scroll toward its beginning: before=$before, after=$after", after < before)
        assertTrue("This gesture must leave content above the viewport", after > 0f)
        assertEquals("The scrolled list owns the fling, not the sheet", PanelStop.EXPANDED, stop.get())
    }

    @Test fun draggingContentDownAtItsBeginningStillCollapsesTheSheet() {
        val stop = AtomicReference(PanelStop.MIDDLE)
        scrollingSheet(stop)
        expand()
        assertEquals(0f, scrollOffset(), 0.1f)
        compose.onNode(hasScrollAction()).performTouchInput {
            swipe(Offset(center.x, 40f), Offset(center.x, height - 20f), 550)
        }
        compose.waitForIdle()
        assertEquals("Unconsumed downward motion at the list top must reach the collapsed anchor", PanelStop.COLLAPSED, stop.get())
    }

    @Test fun largeTextNearbyCardsRemainReachableInShortNarrowWindow() {
        val selected = mutableListOf<String>()
        compose.setContent {
            val platformDensity = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(platformDensity.density, fontScale = 2f)) {
                LycorisTheme {
                    BoxWithConstraints(Modifier.width(320.dp).height(260.dp).clipToBounds(), contentAlignment = Alignment.BottomCenter) {
                        val density = LocalDensity.current
                        MapPanel(with(density) { maxHeight.toPx() }, with(density) { 284.dp.toPx() }, PanelStop.MIDDLE,
                            "Large type", {}, {}, Modifier.testTag("adaptive-sheet")) {
                            item { NearbyCategories(false, selected::add) }
                        }
                    }
                }
            }
        }
        listOf("Accessible Toilets", "Nursing Rooms", "Medical Institutions").forEach {
            compose.onNodeWithText(it).performScrollTo().assertIsDisplayed().performClick()
        }
        compose.runOnIdle { assertEquals(listOf("accessible_toilet", "baby_room", "friendly_clinic"), selected) }
    }

    @Test fun reducedAndRestoredViewportKeepsFinalActionReachable() {
        val windowHeight = mutableStateOf(520.dp)
        val clicked = java.util.concurrent.atomic.AtomicInteger(0)
        val visible = AtomicReference(0f)
        var densityValue = 1f
        compose.setContent {
            LycorisTheme {
                BoxWithConstraints(Modifier.fillMaxWidth().height(windowHeight.value).clipToBounds(), contentAlignment = Alignment.BottomCenter) {
                    val density = LocalDensity.current
                    densityValue = density.density
                    var stop by remember { mutableStateOf(PanelStop.MIDDLE) }
                    MapPanel(with(density) { maxHeight.toPx() }, with(density) { 284.dp.toPx() }, stop, "Editable detail",
                        { stop = it }, visible::set, Modifier.testTag("adaptive-sheet")) {
                        items(24, key = { "detail-$it" }) { Text("Detail row $it", Modifier.fillMaxWidth().height(48.dp)) }
                        item("final-action") {
                            Button(onClick = { clicked.incrementAndGet() }, modifier = Modifier.fillMaxWidth()) { Text("Final action") }
                        }
                    }
                }
            }
        }
        expand()
        compose.runOnIdle { windowHeight.value = 220.dp }
        compose.onNodeWithTag("panel-list").performScrollToIndex(24)
        compose.onNodeWithText("Final action").assertIsDisplayed().performClick()
        assertTrue("The sheet must fit the reduced content area", visible.get() <= 220f * densityValue + 1f)
        compose.runOnIdle { windowHeight.value = 520.dp }
        expand()
        compose.onNodeWithTag("panel-list").performScrollToIndex(24)
        compose.onNodeWithText("Final action").assertIsDisplayed().performClick()
        assertEquals(2, clicked.get())
    }

    private fun scrollingSheet(observed: AtomicReference<PanelStop>) {
        compose.setContent {
            LycorisTheme {
                BoxWithConstraints(Modifier.fillMaxWidth().height(400.dp).clipToBounds(), contentAlignment = Alignment.BottomCenter) {
                    val density = LocalDensity.current
                    var stop by remember { mutableStateOf(PanelStop.MIDDLE) }
                    MapPanel(with(density) { maxHeight.toPx() }, with(density) { 220.dp.toPx() }, stop, "Nested scrolling",
                        { stop = it; observed.set(it) }, {}, Modifier.testTag("adaptive-sheet")) {
                        items(120, key = { it }) { Text("Row $it", Modifier.fillMaxWidth().height(48.dp)) }
                    }
                }
            }
        }
    }

    private fun expand() {
        compose.onNodeWithTag("adaptive-sheet").performSemanticsAction(SemanticsActions.Expand) { it() }
        compose.waitForIdle()
    }
    private fun scrollOffset(): Float {
        val range = compose.onNode(hasScrollAction()).fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange]
        var value = 0f
        compose.runOnIdle { value = range.value() }
        return value
    }
}
