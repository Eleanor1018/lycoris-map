package com.lycoris.maps.feature.map

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.MicNone
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.lycoris.maps.core.designsystem.FigmaIcon
import com.lycoris.maps.core.designsystem.LycorisColors
import com.lycoris.maps.core.map.MapViewHost
import com.lycoris.maps.core.map.MapStyles
import com.lycoris.maps.BuildConfig
import com.lycoris.maps.core.map.NativeMapState
import com.lycoris.maps.core.map.MapBounds
import com.lycoris.maps.core.map.MapCamera
import com.lycoris.maps.core.map.GoogleMapViewHost
import com.lycoris.maps.core.map.TencentMapViewHost
import com.lycoris.maps.core.data.preferences.MapSource
import com.lycoris.maps.core.data.preferences.SearchType
import com.lycoris.maps.core.model.Language
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

private enum class MapLoad { LOADING, LOADED, FAILED }

enum class MainSection { EXPLORE, BOOKMARKS, SETTINGS }

data class CategoryRow(val key: String, val en: String, val zh: String, val color: Color)
val nearbyCategories = listOf(
    CategoryRow("accessible_toilet", "Accessible Toilets", "无障碍卫生间", LycorisColors.Blue),
    CategoryRow("baby_room", "Nursing Rooms", "母婴室", LycorisColors.Orange),
    CategoryRow("friendly_clinic", "Medical Institutions", "医疗机构", LycorisColors.Green),
)

/** Figma 53:580/53:724/53:1379; native system bars consume their own insets. */
@Composable
fun HomeScreen(
    map: NativeMapState,
    chinese: Boolean,
    section: MainSection,
    onSection: (MainSection) -> Unit,
    query: String,
    onQuery: (String) -> Unit,
    onSearch: () -> Unit,
    onVoice: () -> Unit,
    initials: String,
    onAccount: () -> Unit,
    onLocate: () -> Unit,
    onNearby: (String?) -> Unit,
    onContribute: () -> Unit,
    onMapSource: () -> Unit,
    onSetting: (String) -> Unit,
    radius: Int,
    mapSourceName: String,
    secondaryTitle: String? = null,
    secondaryKey: String? = null,
    onCloseSecondary: () -> Unit = {},
    onBackSecondary: (() -> Unit)? = null,
    notice: String? = null,
    onDismissNotice: () -> Unit = {},
    onCameraIdle: (MapCamera, MapBounds) -> Unit = { _, _ -> },
    onMapClick: (Double, Double) -> Unit = { _, _ -> },
    onUserGesture: () -> Unit = {},
    onAttribution: () -> Unit = {},
    panelContent: LazyListScope.() -> Unit = {},
    mapLayers: @Composable () -> Unit = {},
    mapSource: MapSource = MapSource.OSM,
    searchType: SearchType = SearchType.ALL,
) {
    var reload by remember { mutableIntStateOf(0) }
    val rasterStyle = remember(mapSource) {
        if (mapSource == MapSource.TIANDITU) MapStyles.tianditu(BuildConfig.TIANDITU_MAPS_API_KEY) else MapStyles.osm
    }
    var mapLoad by remember(mapSource, reload) { mutableStateOf(MapLoad.LOADING) }
    var dismissMapFailure by remember(mapSource, reload) { mutableStateOf(false) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(mapSource, reload, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            delay(20_000)
            if (mapLoad == MapLoad.LOADING) mapLoad = MapLoad.FAILED
        }
    }
    var stop by rememberSaveable { mutableStateOf(PanelStop.MIDDLE) }
    var visibleHeight by remember { mutableFloatStateOf(0f) }
    var middleMeasured by remember { mutableFloatStateOf(0f) }
    var measuredNavHeight by remember { mutableFloatStateOf(0f) }
    var measuredSearchHeight by remember { mutableFloatStateOf(0f) }
    val density = LocalDensity.current
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val imeVisible = WindowInsets.ime.getBottom(density) > 0
    val secondary = secondaryTitle != null
    val pageKey = secondaryKey ?: secondaryTitle ?: section.name
    var stopPageKey by rememberSaveable { mutableStateOf(pageKey) }
    LaunchedEffect(pageKey) {
        if (stopPageKey != pageKey) {
            stop = PanelStop.MIDDLE
            stopPageKey = pageKey
        }
    }
    BackHandler(enabled = imeVisible || secondary || stop == PanelStop.EXPANDED) {
        // System Back can reach the app callback while the IME is still visible (including
        // Android 17). Dismiss that input layer without also closing its search/account page.
        if (imeVisible) {
            keyboard?.hide()
            focus.clearFocus()
        } else {
            focus.clearFocus()
            if (secondary) (onBackSecondary ?: onCloseSecondary)() else stop = PanelStop.MIDDLE
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
        val topInset = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
        val navInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
        val keyboardInset = WindowInsets.ime.asPaddingValues().calculateBottomPadding()
        val navHeight = if (measuredNavHeight > 0f) with(density) { measuredNavHeight.toDp() } else 64.dp
        val searchHeight = if (measuredSearchHeight > 0f) with(density) { measuredSearchHeight.toDp() } else 60.dp
        val bottom = if (keyboardInset > navInset) keyboardInset else navInset + navHeight
        val maxPanel = with(density) { (maxHeight - bottom - topInset - 4.dp).coerceAtLeast(52.dp).toPx() }
        val middle = if (!secondary && section != MainSection.BOOKMARKS && middleMeasured > 0) middleMeasured else with(density) { 284.dp.toPx() }

        key(mapSource, reload) {
            if (mapSource == MapSource.GOOGLE) {
                GoogleMapViewHost(Modifier.fillMaxSize(), state = map,
                    onCameraIdle = onCameraIdle, onMapClick = onMapClick, onUserGesture = onUserGesture,
                    topPaddingPx = with(density) { (topInset + searchHeight + 8.dp).roundToPx() },
                    bottomPaddingPx = with(density) { bottom.roundToPx() } + visibleHeight.toInt(),
                    onTilesLoaded = { mapLoad = MapLoad.LOADED }, onUnavailable = { mapLoad = MapLoad.FAILED })
            } else if (mapSource == MapSource.TENCENT) {
                TencentMapViewHost(Modifier.fillMaxSize(), state = map,
                    onCameraIdle = onCameraIdle, onMapClick = onMapClick, onUserGesture = onUserGesture,
                    topPaddingPx = with(density) { (topInset + searchHeight + 8.dp).roundToPx() },
                    bottomPaddingPx = with(density) { bottom.roundToPx() } + visibleHeight.toInt(),
                    onTilesLoaded = { mapLoad = MapLoad.LOADED }, onUnavailable = { mapLoad = MapLoad.FAILED })
            } else {
                MapViewHost(Modifier.fillMaxSize(), state = map, styleJson = rasterStyle,
                    rasterSourceIds = if (mapSource == MapSource.TIANDITU) MapStyles.tiandituSources else MapStyles.osmSources,
                    onCameraIdle = onCameraIdle,
                    onMapClick = onMapClick, onUserGesture = onUserGesture,
                    onTilesLoaded = { mapLoad = MapLoad.LOADED }, onUnavailable = { mapLoad = MapLoad.FAILED })
            }
            mapLayers()
        }
        SearchBar(query, onQuery, {
            focus.clearFocus(); stop = PanelStop.EXPANDED; onSearch()
        }, onVoice, initials, onAccount, chinese,
            Modifier.align(Alignment.TopCenter).padding(top = topInset + 4.dp, start = 8.dp, end = 8.dp).onSizeChanged { measuredSearchHeight = it.height.toFloat() })
        Column(Modifier.align(Alignment.TopEnd).padding(top = topInset + searchHeight + 16.dp, end = 13.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            MapTool("layers", if (chinese) "地图来源" else "Map source", onMapSource)
            MapTool("nearby", if (chinese) "附近点位" else "Nearby places", { onNearby(null) })
            MapTool("contribute", if (chinese) "贡献点位" else "Contribute a place", onContribute, small = true)
        }
        val visibleDp = with(density) { visibleHeight.toDp() }
        if (stop != PanelStop.EXPANDED) {
            MapTool("locate", if (chinese) "定位" else "Locate me", onLocate,
                Modifier.align(Alignment.BottomEnd).padding(end = 8.dp, bottom = bottom + visibleDp + 20.dp), large = true)
        }
        if (mapSource in setOf(MapSource.OSM, MapSource.TIANDITU) && maxHeight - bottom - visibleDp > topInset + 70.dp) {
            Box(Modifier.align(Alignment.BottomStart).padding(start = 8.dp, bottom = bottom + visibleDp)
                .widthIn(max = (maxWidth - 82.dp).coerceAtLeast(1.dp)).heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onAttribution), contentAlignment = Alignment.BottomStart) {
                Text(if (mapSource == MapSource.TIANDITU) "© 天地图" else "© OpenStreetMap contributors", Modifier.background(Color.White.copy(alpha = 0.86f)).padding(horizontal = 4.dp, vertical = 2.dp),
                    fontSize = 11.sp, lineHeight = 14.sp, color = Color(0xFF005EA8))
            }
        }
        val showMapFailure = notice == null && mapLoad == MapLoad.FAILED && !dismissMapFailure
        if (notice != null || showMapFailure) {
            Surface(Modifier.align(Alignment.TopCenter).padding(top = topInset + searchHeight + 16.dp, start = 12.dp, end = 72.dp),
                shape = RoundedCornerShape(20.dp), tonalElevation = 3.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).padding(start = 16.dp, top = 12.dp, bottom = 12.dp)) {
                        Text(notice ?: if (chinese) "地图暂时无法加载，请重试或切换地图来源。" else "Map unavailable. Retry or choose another map source.", style = MaterialTheme.typography.bodyMedium)
                        if (showMapFailure) Row {
                            TextButton({ map.camera = map.snapshotCamera(); reload++ }) { Text(if (chinese) "重试" else "Retry") }
                            TextButton(onMapSource) { Text(if (chinese) "切换地图" else "Change map") }
                        }
                    }
                    IconButton({ if (showMapFailure) dismissMapFailure = true else onDismissNotice() }) { Icon(Icons.Rounded.Close, if (chinese) "关闭提示" else "Dismiss message") }
                }
            }
        }
        Box(Modifier.fillMaxSize().padding(bottom = bottom).clipToBounds(), contentAlignment = Alignment.BottomCenter) {
            MapPanel(maxPanel, middle.coerceAtMost(maxPanel), stop, pageKey,
                onStop = { value ->
                    if (secondary && value == PanelStop.COLLAPSED) { onCloseSecondary(); stop = PanelStop.MIDDLE }
                    else stop = value
                },
                onVisibleHeight = { visibleHeight = it },
            ) {
                item(key = "panel-header", contentType = "header") {
                if (secondary) {
                    PanelTitle(secondaryTitle.orEmpty(), onCloseSecondary, chinese, startPadding = 30.dp, topPadding = 12.dp, bottomPadding = 8.dp)
                } else {
                    Column(Modifier.fillMaxWidth().onSizeChangedCompat { if (section != MainSection.BOOKMARKS) middleMeasured = it + with(density) { 12.dp.toPx() } }) {
                        PanelTitle(when (section) {
                            MainSection.EXPLORE -> if (chinese) "查找附近" else "Find Nearby"
                            MainSection.BOOKMARKS -> if (chinese) "收藏" else "Bookmarks"
                            MainSection.SETTINGS -> if (chinese) "设置" else "Settings"
                        }, chinese = chinese, startPadding = if (section == MainSection.BOOKMARKS) 30.dp else 41.dp)
                        when (section) {
                            MainSection.EXPLORE -> NearbyCategories(chinese, onNearby)
                            MainSection.SETTINGS -> SettingsRows(chinese, radius, mapSourceName, searchType, onSetting)
                            MainSection.BOOKMARKS -> Unit
                        }
                        if (section != MainSection.BOOKMARKS) Spacer(Modifier.height(18.dp))
                    }
                }
                }
                panelContent()
                item(key = "panel-footer", contentType = "spacing") { Spacer(Modifier.height(22.dp)) }
            }
        }
        if (keyboardInset <= navInset) {
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(LycorisColors.Surface).padding(bottom = navInset)) {
                Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).onSizeChanged { measuredNavHeight = it.height.toFloat() }, verticalAlignment = Alignment.CenterVertically) {
                    MainSection.entries.forEach { item ->
                        val label = when (item) {
                            MainSection.EXPLORE -> if (chinese) "探索" else "Explore"
                            MainSection.BOOKMARKS -> if (chinese) "收藏" else "Bookmarks"
                            MainSection.SETTINGS -> if (chinese) "设置" else "Settings"
                        }
                        val icon = when (item) { MainSection.EXPLORE -> "explore"; MainSection.BOOKMARKS -> "bookmark"; MainSection.SETTINGS -> "settings" }
                        Column(Modifier.weight(1f).selectable(section == item, role = Role.Tab, onClick = { focus.clearFocus(); onSection(item); stop = PanelStop.MIDDLE })
                            .padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Box(Modifier.size(56.dp, 32.dp).background(if (section == item) LycorisColors.Card else Color.Transparent, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
                                FigmaIcon(icon, Modifier.size(28.dp))
                            }
                            Text(label, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp, color = LycorisColors.SecondaryText)
                        }
                    }
                }
            }
        }
    }
}

private fun Modifier.onSizeChangedCompat(onHeight: (Float) -> Unit): Modifier = this.then(
    Modifier.onSizeChanged { onHeight(it.height.toFloat()) },
)

@Composable
private fun SearchBar(query: String, onQuery: (String) -> Unit, onSearch: () -> Unit, onVoice: () -> Unit, initials: String, onAccount: () -> Unit, chinese: Boolean, modifier: Modifier) {
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(22.dp), color = Color(0xFFFAFCF9), shadowElevation = 2.dp) {
        Row(Modifier.heightIn(min = 60.dp).padding(start = 12.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            FigmaIcon("search", Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            BasicTextField(query, onQuery, Modifier.weight(1f).padding(vertical = 12.dp),
                textStyle = TextStyle(fontSize = 16.sp, color = LycorisColors.Text), singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { onSearch() }),
                decorationBox = { field -> Box { if (query.isEmpty()) Text(if (chinese) "搜索点位" else "Search Positions", color = Color(0xFF88898B), fontSize = 16.sp); field() } })
            IconButton(onVoice, Modifier.size(48.dp)) { Icon(Icons.Rounded.MicNone, if (chinese) "语音搜索" else "Voice search", Modifier.size(20.dp), tint = Color(0xFF88898B)) }
            Box(Modifier.size(48.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onAccount)
                .semantics { contentDescription = if (chinese) "账号" else "Account" }, contentAlignment = Alignment.Center) {
                Box(Modifier.size(36.dp).background(Color(0xFFC7C7CB), CircleShape), contentAlignment = Alignment.Center) { Text(initials, fontSize = 14.sp, color = Color(0xFFF7F7F6)) }
            }
        }
    }
}

@Composable
private fun MapTool(icon: String, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, small: Boolean = false, large: Boolean = false) {
    val visual = if (large) 58.dp else if (small) 36.dp else 40.dp
    Box(modifier.size(if (large) 58.dp else 48.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClick)
        .semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Surface(Modifier.size(visual), shape = CircleShape, color = Color.White, shadowElevation = 1.dp) {
            Box(contentAlignment = Alignment.Center) { FigmaIcon(icon, Modifier.size(if (large) 26.dp else if (small) 20.dp else 24.dp)) }
        }
    }
}

@Composable
fun PanelTitle(title: String, onClose: (() -> Unit)? = null, chinese: Boolean = false, startPadding: androidx.compose.ui.unit.Dp = 41.dp, topPadding: androidx.compose.ui.unit.Dp = 0.dp, bottomPadding: androidx.compose.ui.unit.Dp = 0.dp) {
    Row(Modifier.fillMaxWidth().padding(start = startPadding, top = topPadding, end = 24.dp, bottom = bottomPadding).heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f).semantics { heading() }, fontSize = 22.sp, lineHeight = 28.sp, color = LycorisColors.Text)
        if (onClose != null) IconButton(onClose) { Icon(Icons.Rounded.Close, if (chinese) "关闭" else "Close") }
    }
}

@Composable
fun NearbyCategories(chinese: Boolean, onClick: (String) -> Unit) {
    Column(Modifier.padding(horizontal = 30.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        nearbyCategories.forEachIndexed { index, category ->
            Row(Modifier.fillMaxWidth().heightIn(min = 66.dp).clip(groupShape(index, 3)).background(LycorisColors.Card)
                .clickable(role = Role.Button, onClick = { onClick(category.key) }).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(30.dp).background(if (index == 0) Brush.verticalGradient(listOf(Color(0xFF38AEFF), category.color)) else Brush.verticalGradient(listOf(category.color, category.color)), CircleShape), contentAlignment = Alignment.Center) {
                    FigmaIcon(category.key, Modifier.size(24.dp))
                }
                Text(if (chinese) category.zh else category.en, fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, color = Color.Black)
            }
        }
    }
}

@Composable
private fun SettingsRows(chinese: Boolean, radius: Int, mapSourceName: String, searchType: SearchType, onSetting: (String) -> Unit) {
    val rows = listOf(
        Triple("language", if (chinese) "语言" else "Choose Language", if (chinese) "简体中文" else "English"),
        Triple("searchType", if (chinese) "搜索类型" else "Search Type", searchType.title(if (chinese) Language.ZH else Language.EN)),
        Triple("range", if (chinese) "搜索范围" else "Searching Range", if (radius % 1000 == 0) "${radius / 1000}km" else "${radius}m"),
        Triple("source", if (chinese) "地图来源" else "Map Source", mapSourceName),
        Triple("about", if (chinese) "关于 Lycoris Maps" else "About Lycoris Maps", ""),
    )
    Column(Modifier.padding(horizontal = 30.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEachIndexed { index, (key, label, value) ->
            Row(Modifier.fillMaxWidth().heightIn(min = 66.dp).clip(groupShape(index, rows.size)).background(LycorisColors.Card)
                .clickable(role = Role.Button, onClick = { onSetting(key) }).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text(label, Modifier.weight(1f), fontSize = 17.sp)
                if (value.isNotEmpty()) Text(value, Modifier.weight(1f).padding(start = 8.dp), fontSize = 17.sp, textAlign = TextAlign.End, color = LycorisColors.SecondaryText)
                Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, Modifier.padding(start = 4.dp).size(20.dp), tint = LycorisColors.Plum)
            }
        }
    }
}

fun groupShape(index: Int, count: Int) = RoundedCornerShape(
    topStart = if (index == 0) 24.dp else 4.dp,
    topEnd = if (index == 0) 24.dp else 4.dp,
    bottomStart = if (index == count - 1) 24.dp else 4.dp,
    bottomEnd = if (index == count - 1) 24.dp else 4.dp,
)
