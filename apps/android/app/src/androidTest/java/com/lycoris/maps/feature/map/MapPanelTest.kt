package com.lycoris.maps.feature.map

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
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
    // Some CI images disable global animations; supply a non-zero motion scale so the settle fling
    // is a real animation rather than an instantaneous jump, without changing global settings.
    @get:Rule val compose = createComposeRule(
        effectContext = object : androidx.compose.ui.MotionDurationScale {
            override val scaleFactor = 1f
        },
    )

    @Test fun changingContentHeightKeepsMiddleHeaderStableDuringLayout() {
        val extraHeight = mutableStateOf(80.dp)
        val placedTops = java.util.Collections.synchronizedList(mutableListOf<Float>())
        var headerCoordinates: LayoutCoordinates? = null
        compose.setContent {
            LycorisTheme {
                BoxWithConstraints(Modifier.fillMaxWidth().height(620.dp), contentAlignment = Alignment.BottomCenter) {
                    val density = LocalDensity.current
                    MapPanel(with(density) { maxHeight.toPx() }, with(density) { 284.dp.toPx() },
                        PanelStop.MIDDLE, "Nearby", {}, {}) {
                        item("header") {
                            Box(Modifier.fillMaxWidth().height(300.dp)
                                .onGloballyPositioned { headerCoordinates = it; placedTops.add(it.positionInRoot().y) }) {
                                Text("Nearby categories")
                            }
                        }
                        item("results") { Box(Modifier.fillMaxWidth().height(extraHeight.value)) }
                    }
                }
            }
        }
        compose.waitForIdle()
        val expected = requireNotNull(headerCoordinates).positionInRoot().y
        for (height in listOf(124.dp, 80.dp, 200.dp, 80.dp)) {
            compose.runOnIdle { placedTops.clear(); extraHeight.value = height }
            compose.waitForIdle()
            val frames = synchronized(placedTops) { placedTops.toList() }
            assertTrue("The changed layout must have been placed", frames.isNotEmpty())
            assertTrue("Every layout must retain the middle header, expected=$expected actual=$frames",
                frames.all { kotlin.math.abs(it - expected) <= 1f })
        }
    }

    @Test fun visibleHeightTracksThePanelWhileTheFingerIsStillDragging() {
        val visible = java.util.concurrent.atomic.AtomicReference(0f)
        var headerCoordinates: LayoutCoordinates? = null
        var parentBottom = 0f
        var grabberHeight = 0f
        compose.setContent {
            LycorisTheme {
                BoxWithConstraints(Modifier.fillMaxWidth().height(620.dp).onGloballyPositioned {
                    parentBottom = it.positionInRoot().y + it.size.height
                }, contentAlignment = Alignment.BottomCenter) {
                    val density = LocalDensity.current
                    grabberHeight = with(density) { PanelGrabberHeight.toPx() }
                    var stop by remember { mutableStateOf(PanelStop.MIDDLE) }
                    MapPanel(with(density) { maxHeight.toPx() }, with(density) { 284.dp.toPx() },
                        stop, "Nearby", { stop = it }, visible::set) {
                        item("header") {
                            Text("Nearby header", Modifier.fillMaxWidth().height(300.dp)
                                .onGloballyPositioned { headerCoordinates = it })
                        }
                        item("results") { Box(Modifier.fillMaxWidth().height(240.dp)) }
                    }
                }
            }
        }
        compose.waitForIdle()
        val initial = visible.get()
        val handle = compose.onNodeWithTag("panel-grabber").fetchSemanticsNode().boundsInRoot.center
        val rootOrigin = compose.onRoot().fetchSemanticsNode().boundsInRoot.topLeft
        compose.onRoot().performTouchInput { down(handle - rootOrigin); moveBy(Offset(0f, -60f)) }
        try {
            repeat(3) {
                compose.onRoot().performTouchInput { moveBy(Offset(0f, -25f)) }
                compose.waitForIdle()
                val actualVisible = parentBottom - (requireNotNull(headerCoordinates).positionInRoot().y - grabberHeight)
                assertTrue("The panel must follow the upward drag before release", actualVisible > initial + 1f)
                assertEquals("Map controls must receive the panel's current height during the drag",
                    actualVisible, visible.get(), 1f)
            }
        } finally {
            compose.onRoot().performTouchInput { up() }
        }
    }

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
                    expected = with(density) { 228.dp.toPx() }
                    MapPanel(with(density) { maxHeight.toPx() }, with(density) { 284.dp.toPx() }, PanelStop.EXPANDED, "Detail", {}, { visible = it }) {
                        item { Box(Modifier.fillMaxWidth().height(200.dp)) }
                    }
                }
            }
        }
        compose.waitUntil(5_000) { kotlin.math.abs(visible - expected) < 2f }
        compose.runOnIdle { assertEquals(expected, visible, 2f) }
    }

    // A held drag whose underlying result set grows must keep the finger's progress. The
    // list is short enough not to scroll internally, so the drag reaches the sheet through
    // the LazyColumn's touch target rather than the grabber.
    @Test fun contentResizeDuringHeldListDragKeepsFingerProgress() {
        contentResizeDuringHeldDragKeepsFingerProgress(dragFrom = "panel-list")
    }

    // The same held-content-growth case must also hold when the gesture starts on the grabber
    // and is owned by the outer anchoredDraggable.
    @Test fun contentResizeDuringHeldGrabberDragKeepsFingerProgress() {
        contentResizeDuringHeldDragKeepsFingerProgress(dragFrom = "panel-grabber")
    }

    private fun contentResizeDuringHeldDragKeepsFingerProgress(dragFrom: String) {
        val extraResults = mutableStateOf(0)
        var headerY = 0f
        compose.setContent {
            LycorisTheme {
                BoxWithConstraints(Modifier.fillMaxWidth().height(620.dp), contentAlignment = Alignment.BottomCenter) {
                    val density = LocalDensity.current
                    MapPanel(with(density) { maxHeight.toPx() }, with(density) { 284.dp.toPx() },
                        PanelStop.MIDDLE, "Nearby", {}, {}) {
                        item("header") {
                            Box(Modifier.fillMaxWidth().height(120.dp)
                                .onGloballyPositioned { headerY = it.positionInRoot().y }) {
                                Text("Nearby categories")
                            }
                        }
                        items(2, key = { "nearby-$it" }) { Text("Nearby result $it", Modifier.fillMaxWidth().height(72.dp)) }
                        items(extraResults.value, key = { "late-$it" }) { Text("Late result $it", Modifier.fillMaxWidth().height(72.dp)) }
                    }
                }
            }
        }
        compose.waitForIdle()
        val middleY = headerY
        // Press on the chosen surface and drag the sheet downward without releasing. Touch
        // coordinates are root-relative, so the gesture is dispatched on the root.
        val start = compose.onNodeWithTag(dragFrom).fetchSemanticsNode().boundsInRoot.center
        val rootOrigin = compose.onRoot().fetchSemanticsNode().boundsInRoot.topLeft
        try {
            compose.onRoot().performTouchInput { down(start - rootOrigin) }
            repeat(4) {
                compose.onRoot().performTouchInput { moveBy(Offset(0f, 40f)) }
                compose.waitForIdle()
            }
            val heldY = headerY
            assertTrue("A held downward drag must move the panel away from its middle detent", heldY > middleY + 1f)
            // An asynchronous result set arrives while the finger is still down.
            compose.runOnIdle { extraResults.value = 6 }
            compose.waitForIdle()
            val afterResizeY = headerY
            assertEquals(
                "Content growth during a held drag must keep the finger's progress; middleY=$middleY heldY=$heldY afterResizeY=$afterResizeY",
                heldY, afterResizeY, 1f,
            )
        } finally {
            compose.onRoot().performTouchInput { up() }
        }
    }

    // A new finger drag must interrupt the previous fling/animation instead of fighting it.
    @Test fun newHandleDragInterruptsPreviousFling() {
        var headerY = 0f
        compose.setContent {
            LycorisTheme {
                BoxWithConstraints(Modifier.fillMaxWidth().height(620.dp), contentAlignment = Alignment.BottomCenter) {
                    val density = LocalDensity.current
                    MapPanel(with(density) { maxHeight.toPx() }, with(density) { 284.dp.toPx() },
                        PanelStop.MIDDLE, "Nearby", {}, {}) {
                        item("header") {
                            Box(Modifier.fillMaxWidth().height(120.dp)
                                .onGloballyPositioned { headerY = it.positionInRoot().y }) {
                                Text("Nearby categories")
                            }
                        }
                        items(6, key = { "nearby-$it" }) { Text("Nearby result $it", Modifier.fillMaxWidth().height(72.dp)) }
                    }
                }
            }
        }
        // Let the first layout settle with the clock auto-advancing, then pause it.
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
        compose.mainClock.advanceTimeByFrame()
        compose.waitForIdle()
        val middleY = headerY
        val rootOrigin = compose.onRoot().fetchSemanticsNode().boundsInRoot.topLeft
        var pointerDown = false
        try {
            // A fast upward fling on the grabber, released while its settle animation is still
            // running (the paused clock cannot finish the spring).
            val flingHandle = compose.onNodeWithTag("panel-grabber").fetchSemanticsNode().boundsInRoot.center
            compose.onRoot().performTouchInput {
                down(flingHandle - rootOrigin)
                moveBy(Offset(0f, -120f))
                moveBy(Offset(0f, -60f))
                up()
            }
            compose.mainClock.advanceTimeByFrame()
            compose.waitForIdle()
            val flingFirst = headerY
            compose.mainClock.advanceTimeByFrame()
            compose.waitForIdle()
            val flingSecond = headerY
            // The animation must still be changing between two consecutive frames, which shows it
            // is in progress; flingSecond > 1 is only a sanity check that it is not pinned at the top.
            assertTrue("The upward fling must have moved the sheet", flingFirst < middleY - 1f)
            assertTrue(
                "The settle animation must still be running between frames; first=$flingFirst second=$flingSecond",
                kotlin.math.abs(flingSecond - flingFirst) > 0.5f,
            )
            assertTrue("The sheet must not be pinned at the top while the animation runs", flingSecond > 1f)
            // Re-fetch the handle: the panel moved, so the pre-fling coordinate may now sit on the list.
            val heldHandle = compose.onNodeWithTag("panel-grabber").fetchSemanticsNode().boundsInRoot.center
            compose.onRoot().performTouchInput { down(heldHandle - rootOrigin) }
            pointerDown = true
            repeat(4) {
                compose.onRoot().performTouchInput { moveBy(Offset(0f, 40f)) }
                compose.waitForIdle()
            }
            // Advance a single frame and read immediately: the second drag must have moved the sheet.
            compose.mainClock.advanceTimeByFrame()
            compose.waitForIdle()
            val heldY = headerY
            assertTrue("The second drag must move the sheet downward from the fling position", heldY > flingSecond + 1f)
            // The interrupted fling must not pull the sheet back while the finger still holds.
            compose.mainClock.advanceTimeBy(200)
            compose.waitForIdle()
            val stillHeldY = headerY
            assertEquals(
                "The interrupted fling must not move the sheet while the finger holds; flingSecond=$flingSecond heldY=$heldY stillHeldY=$stillHeldY",
                heldY, stillHeldY, 1f,
            )
        } finally {
            if (pointerDown) compose.onRoot().performTouchInput { up() }
            compose.mainClock.autoAdvance = true
        }
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
