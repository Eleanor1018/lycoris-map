package com.lycoris.maps.feature.places

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import com.lycoris.maps.core.data.AccountState
import com.lycoris.maps.core.designsystem.LycorisTheme
import com.lycoris.maps.core.model.Marker
import com.lycoris.maps.core.network.ApiClients
import com.lycoris.maps.core.network.MemoryCookiePersistence
import com.lycoris.maps.core.network.SessionCookieJar
import com.lycoris.maps.feature.map.MapPanel
import com.lycoris.maps.feature.map.PanelStop
import com.lycoris.maps.feature.map.PanelTitle
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Synthetic metadata only; no live accounts, images, location or backend requests. */
class PlaceMetadataTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val marker = Marker(1, 31.2, 121.5, "accessible_toilet", "测试商场无障碍卫生间", description = "位于一楼服务台旁边。",
        venueType = "mall", openTimeStart = "09:00", openTimeEnd = "22:00", hoursTimezone = "Asia/Shanghai")

    @Test fun warningUpdatesAtMinuteBoundaryAndAfterForegroundReturn() {
        val now = AtomicReference(Instant.parse("2026-09-20T13:29:59.900Z"))
        val clock = object : Clock() {
            override fun getZone(): ZoneId = ZoneOffset.UTC
            override fun withZone(zone: ZoneId): Clock = Clock.fixed(instant(), zone)
            override fun instant(): Instant = now.get()
        }
        compose.setContent { LycorisTheme { PlaceTimeScope(clock) { PlaceHours(marker, true) } } }
        compose.onNodeWithText("营业中 · 09:00–22:00").assertIsDisplayed()
        compose.onNodeWithText("即将结束营业").assertDoesNotExist()
        now.set(Instant.parse("2026-09-20T13:30:00Z"))
        compose.waitUntil(5_000) { compose.onAllNodesWithText("即将结束营业").fetchSemanticsNodes().size == 1 }
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        now.set(Instant.parse("2026-09-20T14:00:00Z"))
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.onNodeWithText("已结束营业 · 09:00–22:00").assertIsDisplayed()
        compose.onNodeWithText("即将结束营业").assertDoesNotExist()
    }

    @Test fun largeTextDetailRetainsMetadataAndReachableActionsInNarrowWindow() {
        val clicked = mutableSetOf<String>()
        val origin = "https://example.test/".toHttpUrl()
        val clients = ApiClients(origin.toString(), SessionCookieJar(origin, MemoryCookiePersistence()), "LycorisAndroid/QA")
        compose.setContent {
            val actual = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(actual.density, fontScale = 2f),
                LocalPlaceTime provides Instant.parse("2026-09-20T13:45:00Z")) {
                LycorisTheme {
                    BoxWithConstraints(Modifier.width(320.dp).height(480.dp).clipToBounds(), contentAlignment = Alignment.BottomCenter) {
                        val density = LocalDensity.current
                        MapPanel(with(density) { maxHeight.toPx() }, with(density) { 284.dp.toPx() }, PanelStop.EXPANDED,
                            "detail:1", {}, {}, Modifier.testTag("metadata-sheet")) {
                            item { PanelTitle(marker.title, { clicked.add("close") }, true, startPadding = 30.dp, topPadding = 12.dp, bottomPadding = 8.dp) }
                            item { PlaceDetailContent(marker, clients, AccountState(), true, marker.lat, marker.lng,
                                { clicked.add("bookmark") }, { clicked.add("navigate") }, { clicked.add("share") }, { clicked.add("edit") }) }
                            item { Spacer(Modifier.height(22.dp)) }
                        }
                    }
                }
            }
        }
        compose.onNodeWithText("商场").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("即将结束营业").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("营业中 · 09:00–22:00").performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("编辑点位").performScrollTo().performClick()
        compose.onNodeWithText("导航").performScrollTo().performClick()
        compose.onNodeWithContentDescription("分享点位").performScrollTo().performClick()
        compose.onNodeWithContentDescription("收藏点位").performScrollTo().performClick()
        compose.onNodeWithTag("panel-list").performScrollToIndex(0)
        compose.onNodeWithContentDescription("关闭").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(setOf("close", "edit", "navigate", "share", "bookmark"), clicked) }
    }
}
