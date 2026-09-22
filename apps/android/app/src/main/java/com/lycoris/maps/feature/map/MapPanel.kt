package com.lycoris.maps.feature.map

import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.MutatePriority
import androidx.compose.foundation.gestures.AnchoredDraggableState
import androidx.compose.foundation.gestures.AnchoredDraggableDefaults
import androidx.compose.foundation.gestures.DraggableAnchors
import androidx.compose.foundation.gestures.FlingBehavior
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.ScrollScope
import androidx.compose.foundation.gestures.animateTo
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import com.lycoris.maps.core.designsystem.LycorisColors
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

internal val PanelGrabberHeight = 28.dp

/** Persistent, nonmodal sheet: map gestures outside the sheet always remain available. */
@Composable
fun MapPanel(
    availableHeight: Float,
    middleContentHeight: Float,
    requestedStop: PanelStop,
    pageKey: String,
    onStop: (PanelStop) -> Unit,
    onVisibleHeight: (Float) -> Unit,
    modifier: Modifier = Modifier,
    content: LazyListScope.() -> Unit,
) {
    val density = LocalDensity.current
    val collapsed = with(density) { 52.dp.toPx() }
    var geometry by remember {
        mutableStateOf(PanelGeometry.measure(availableHeight, middleContentHeight, middleContentHeight, collapsed))
    }
    val state = remember { AnchoredDraggableState(requestedStop) }
    val scope = rememberCoroutineScope()
    val scroll = rememberLazyListState()
    val currentOnStop by rememberUpdatedState(onStop)
    val currentOnVisibleHeight by rememberUpdatedState(onVisibleHeight)
    val currentRequestedStop by rememberUpdatedState(requestedStop)
    val currentPageKey by rememberUpdatedState(pageKey)
    val flingThreshold = with(density) { 300.dp.toPx() }
    // Real drag signals from Foundation: the outer handle and the list itself.
    val handleInteractions = remember { MutableInteractionSource() }
    val handleDragging by handleInteractions.collectIsDraggedAsState()
    val listDragging by scroll.interactionSource.collectIsDraggedAsState()
    val isUserDragging = handleDragging || listDragging
    // Remember which page/stop owned the drag so it never leaks into a new page or an explicit
    // external stop request.
    var dragControl by remember { mutableStateOf<Pair<String, PanelStop>?>(null) }
    LaunchedEffect(isUserDragging) {
        if (isUserDragging) {
            // Take the state's mutate lock at user-input priority to cancel any fling/animateTo
            // still running from the previous gesture. The empty drag only acquires the lock; the
            // actual finger deltas continue to arrive through the plain draggable, so the outer
            // gesture event loop is not placed back inside anchoredDrag.
            state.anchoredDrag(MutatePriority.UserInput) {}
            dragControl = currentPageKey to currentRequestedStop
        } else {
            dragControl = null
        }
    }

    // Programmatic control follows explicit stop/page changes only. Re-measurement updates
    // anchors in place without stealing an in-progress gesture.
    LaunchedEffect(requestedStop, pageKey) {
        val target = geometry.anchorFor(requestedStop)
        if (state.targetValue != target) state.animateTo(target, spring(dampingRatio = 0.9f, stiffness = 420f))
    }

    suspend fun settleUserStop(logicalStop: PanelStop) {
        val requestAtStart = currentRequestedStop
        val pageAtStart = currentPageKey
        state.animateTo(geometry.anchorFor(logicalStop), spring(dampingRatio = 0.9f, stiffness = 420f))
        if (currentRequestedStop == requestAtStart && currentPageKey == pageAtStart && logicalStop != currentRequestedStop) {
            currentOnStop(logicalStop)
        }
    }

    // settledValue also changes during updateAnchors: observing it cannot identify a user action.
    // Report direct gestures from their actual fling completion, keeping Foundation's fling physics.
    val defaultFling = AnchoredDraggableDefaults.flingBehavior(state)
    val userFling = remember(state, defaultFling) {
        object : FlingBehavior {
            override suspend fun ScrollScope.performFling(initialVelocity: Float): Float {
                val requestAtStart = currentRequestedStop
                val pageAtStart = currentPageKey
                val remaining = with(defaultFling) { this@performFling.performFling(initialVelocity) }
                // The final anchor is already available from the actual offset; do not read stale
                // settledValue after the fling.
                val physicalStop = state.anchors.closestAnchor(state.requireOffset())
                if (physicalStop != null && currentRequestedStop == requestAtStart && currentPageKey == pageAtStart) {
                    val logicalStop = geometry.userStop(physicalStop, currentRequestedStop)
                    if (logicalStop != currentRequestedStop) currentOnStop(logicalStop)
                }
                return remaining
            }
        }
    }
    // A plain draggable drives the sheet one delta at a time without restarting a gesture event
    // loop when anchors change; a re-measure mid-drag therefore cannot replay the last delta.
    val sheetScrollScope = remember(state) {
        object : ScrollScope {
            override fun scrollBy(pixels: Float): Float = state.dispatchRawDelta(pixels)
        }
    }
    val sheetDragState = rememberDraggableState { delta -> state.dispatchRawDelta(delta) }
    LaunchedEffect(pageKey) { scroll.scrollToItem(0) }

    val connection = remember(state, scroll, flingThreshold) {
        object : NestedScrollConnection {
            private var sheetMoved = false

            private fun drag(delta: Float): Offset {
                val consumed = state.dispatchRawDelta(delta)
                if (consumed != 0f) sheetMoved = true
                return Offset(0f, consumed)
            }

            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source != NestedScrollSource.UserInput || available.y >= 0) return Offset.Zero
                return drag(available.y)
            }
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (source != NestedScrollSource.UserInput) return Offset.Zero
                return drag(available.y)
            }
            override suspend fun onPreFling(available: Velocity): Velocity {
                // At full height the inner list owns flings while it can still scroll.
                // Do not collapse the sheet when a scrolled list moves toward its beginning;
                // onPostFling receives only the list's unconsumed remainder.
                if (state.offset <= 0f && (available.y < 0 || scroll.canScrollBackward)) return Velocity.Zero
                if (!sheetMoved && available.y == 0f) return Velocity.Zero
                sheetMoved = false
                val target = geometry.destination(state.offset, available.y, flingThreshold)
                settleUserStop(geometry.userStop(target, currentRequestedStop))
                return available
            }
            override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
                // Scrolling the list or bringing an item into view is not a sheet-stop request.
                if (!sheetMoved && available.y == 0f) return Velocity.Zero
                sheetMoved = false
                val target = geometry.destination(state.offset, available.y, flingThreshold)
                settleUserStop(geometry.userStop(target, currentRequestedStop))
                return available
            }
        }
    }
    Column(
        // Measure independently of the previous anchor height: short content wraps naturally,
        // while long content gives LazyColumn a finite viewport without measuring every row.
        modifier.fillMaxWidth().heightIn(
            min = with(density) { collapsed.coerceAtMost(availableHeight).toDp() },
            max = with(density) { availableHeight.toDp() },
        ).layout { measurable, constraints ->
            val placeable = measurable.measure(constraints)
            val measuredGeometry = PanelGeometry.measure(availableHeight, placeable.height.toFloat(), middleContentHeight, collapsed)
            val previousGeometry = geometry
            val previousOffset = state.offset
            // A held drag keeps its visible top. The parent is BottomCenter, so when the content
            // full height changes the sheet origin moves; add the full delta to the raw offset and
            // clamp into the new bounds. Guard on the same page/stop and a finite offset, and also
            // correct when only middle changes while full stays equal.
            val heldOffset = if (isUserDragging && dragControl == (currentPageKey to currentRequestedStop) &&
                previousOffset.isFinite() && measuredGeometry != previousGeometry) {
                (previousOffset + (measuredGeometry.full - previousGeometry.full))
                    .coerceIn(0f, measuredGeometry.offset(PanelStop.COLLAPSED))
            } else null
            // Update anchors before placing this measured height. Feeding onSizeChanged back
            // through composition placed new content at the previous height's offset for a frame.
            geometry = measuredGeometry
            state.updateAnchors(DraggableAnchors {
                PanelStop.COLLAPSED at measuredGeometry.offset(PanelStop.COLLAPSED)
                if (measuredGeometry.full > measuredGeometry.middle + 1f) PanelStop.EXPANDED at 0f
                PanelStop.MIDDLE at measuredGeometry.offset(PanelStop.MIDDLE)
            }, newTarget = measuredGeometry.anchorFor(currentRequestedStop))
            // Compensate in the same measured pass; do not defer through a SideEffect, and do not
            // leave the placement reading a state offset that no longer matches the finger.
            if (heldOffset != null) state.dispatchRawDelta(heldOffset - state.offset)
            layout(placeable.width, placeable.height) {
                val offset = state.offset.takeIf { it.isFinite() }.orEmptyOffset(measuredGeometry).roundToInt()
                placeable.placeRelative(0, offset)
                // Placement observes drag offsets even when no recomposition is needed.
                currentOnVisibleHeight(measuredGeometry.full - offset)
            }
        }
            .clip(RoundedCornerShape(topStart = 25.dp, topEnd = 25.dp))
            .background(LycorisColors.Surface).nestedScroll(connection)
            .draggable(
                state = sheetDragState,
                orientation = Orientation.Vertical,
                interactionSource = handleInteractions,
                onDragStopped = { velocity ->
                    // Run the retained fling while holding the state's mutate lock so the next
                    // finger drag can cancel it through the UserInput-priority empty drag.
                    state.anchoredDrag { with(userFling) { sheetScrollScope.performFling(velocity) } }
                },
            )
            .semantics {
                paneTitle = pageKey
                expand { scope.launch { settleUserStop(PanelStop.EXPANDED) }; true }
                collapse { scope.launch { settleUserStop(PanelStop.COLLAPSED) }; true }
            },
    ) {
        Box(Modifier.testTag("panel-grabber").fillMaxWidth().height(PanelGrabberHeight), contentAlignment = androidx.compose.ui.Alignment.TopCenter) {
            Box(Modifier.padding(top = 8.dp).width(48.dp).height(4.dp)
                .background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.2f), RoundedCornerShape(4.dp)))
        }
        LazyColumn(Modifier.fillMaxWidth().testTag("panel-list"), state = scroll, content = content)
    }
}

private fun Float?.orEmptyOffset(geometry: PanelGeometry) = this ?: geometry.offset(PanelStop.MIDDLE)

private fun PanelGeometry.anchorFor(stop: PanelStop): PanelStop =
    if (stop == PanelStop.EXPANDED && full <= middle + 1f) PanelStop.MIDDLE else stop

private fun PanelGeometry.userStop(physicalStop: PanelStop, requestedStop: PanelStop): PanelStop =
    if (physicalStop == PanelStop.MIDDLE && requestedStop == PanelStop.EXPANDED && anchorFor(requestedStop) == PanelStop.MIDDLE) {
        PanelStop.EXPANDED
    } else physicalStop
