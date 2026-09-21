package com.lycoris.maps.feature.map

import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.AnchoredDraggableState
import androidx.compose.foundation.gestures.AnchoredDraggableDefaults
import androidx.compose.foundation.gestures.DraggableAnchors
import androidx.compose.foundation.gestures.FlingBehavior
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.ScrollScope
import androidx.compose.foundation.gestures.anchoredDraggable
import androidx.compose.foundation.gestures.animateTo
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
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.IntOffset
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
    // Keep the last actual size across page changes: onSizeChanged does not fire again when
    // two consecutive pages have the same measured height.
    var measuredHeight by remember { mutableFloatStateOf(middleContentHeight) }
    val geometry = PanelGeometry.measure(availableHeight, measuredHeight, middleContentHeight, collapsed)
    val state = remember { AnchoredDraggableState(requestedStop) }
    val scope = rememberCoroutineScope()
    val scroll = rememberLazyListState()
    val currentOnStop by rememberUpdatedState(onStop)
    val currentGeometry by rememberUpdatedState(geometry)
    val currentRequestedStop by rememberUpdatedState(requestedStop)
    val currentPageKey by rememberUpdatedState(pageKey)
    val flingThreshold = with(density) { 300.dp.toPx() }

    SideEffect {
        // Geometry can merge/split physical anchors, but never chooses a new logical stop.
        // In particular, an expanded request stays expanded while its physical anchor is middle.
        state.updateAnchors(DraggableAnchors {
            PanelStop.COLLAPSED at geometry.offset(PanelStop.COLLAPSED)
            // Keep middle as the canonical anchor when short content makes middle == expanded.
            if (geometry.full > geometry.middle + 1f) PanelStop.EXPANDED at 0f
            PanelStop.MIDDLE at geometry.offset(PanelStop.MIDDLE)
        }, newTarget = geometry.anchorFor(requestedStop))
    }
    LaunchedEffect(requestedStop, pageKey, geometry) {
        val target = geometry.anchorFor(requestedStop)
        if (state.targetValue != target) state.animateTo(target, spring(dampingRatio = 0.9f, stiffness = 420f))
    }

    suspend fun settleUserStop(logicalStop: PanelStop) {
        val requestAtStart = currentRequestedStop
        val pageAtStart = currentPageKey
        state.animateTo(currentGeometry.anchorFor(logicalStop), spring(dampingRatio = 0.9f, stiffness = 420f))
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
                // Foundation commits settledValue after this callback returns. The final anchor
                // is already available from the actual offset; do not read stale settledValue here.
                val physicalStop = state.anchors.closestAnchor(state.requireOffset())
                if (physicalStop != null && currentRequestedStop == requestAtStart && currentPageKey == pageAtStart) {
                    val logicalStop = currentGeometry.userStop(physicalStop, currentRequestedStop)
                    if (logicalStop != currentRequestedStop) currentOnStop(logicalStop)
                }
                return remaining
            }
        }
    }
    LaunchedEffect(pageKey) { scroll.scrollToItem(0) }
    SideEffect { onVisibleHeight(geometry.full - state.offset.takeIf { it.isFinite() }.orEmptyOffset(geometry)) }

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
                val target = currentGeometry.destination(state.offset, available.y, flingThreshold)
                settleUserStop(currentGeometry.userStop(target, currentRequestedStop))
                return available
            }
            override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
                // Scrolling the list or bringing an item into view is not a sheet-stop request.
                if (!sheetMoved && available.y == 0f) return Velocity.Zero
                sheetMoved = false
                val target = currentGeometry.destination(state.offset, available.y, flingThreshold)
                settleUserStop(currentGeometry.userStop(target, currentRequestedStop))
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
        ).onSizeChanged { measuredHeight = it.height.toFloat() }
            .offset { IntOffset(0, state.offset.takeIf { it.isFinite() }.orEmptyOffset(geometry).roundToInt()) }
            .clip(RoundedCornerShape(topStart = 25.dp, topEnd = 25.dp))
            .background(LycorisColors.Surface).nestedScroll(connection)
            .anchoredDraggable(state, Orientation.Vertical, flingBehavior = userFling)
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
