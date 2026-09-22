package com.lycoris.maps.core.designsystem

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.sp
import com.lycoris.maps.R

/** Local font bytes for Chinese and Latin UI; no font provider, Play services or network. */
val LycorisFontFamily = FontFamily(
    listOf(FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold).map { weight ->
        Font(R.font.noto_sans_sc, weight = weight,
            variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)))
    },
)

private fun textStyle(size: Int, line: Int, weight: FontWeight = FontWeight.Normal, tracking: Float = 0f) = TextStyle(
    fontFamily = LycorisFontFamily,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = line.sp,
    letterSpacing = tracking.sp,
    platformStyle = PlatformTextStyle(includeFontPadding = false),
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

/** Pinned Material 3 scale. Keep sp so the user's accessibility text size still works. */
val LycorisTypography = Typography(
    displayLarge = textStyle(57, 64, tracking = -0.2f),
    displayMedium = textStyle(45, 52),
    displaySmall = textStyle(36, 44),
    headlineLarge = textStyle(32, 40),
    headlineMedium = textStyle(28, 36),
    headlineSmall = textStyle(24, 32),
    titleLarge = textStyle(22, 28),
    titleMedium = textStyle(16, 24, FontWeight.Medium, 0.2f),
    titleSmall = textStyle(14, 20, FontWeight.Medium, 0.1f),
    bodyLarge = textStyle(16, 24, tracking = 0.5f),
    bodyMedium = textStyle(14, 20, tracking = 0.2f),
    bodySmall = textStyle(12, 16, tracking = 0.4f),
    labelLarge = textStyle(14, 20, FontWeight.Medium, 0.1f),
    labelMedium = textStyle(12, 16, FontWeight.Medium, 0.5f),
    labelSmall = textStyle(11, 16, FontWeight.Medium, 0.5f),
)

/** Existing screen-specific sizes, centralized without changing spacing or hierarchy. */
object LycorisTextStyles {
    val PanelTitle = LycorisTypography.bodyLarge.copy(fontSize = 22.sp, lineHeight = 28.sp)
    val PlaceTitle = LycorisTypography.bodyLarge.copy(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)
    val SettingsRow = LycorisTypography.bodyLarge.copy(fontSize = 17.sp)
    val PlaceSummary = LycorisTypography.bodyLarge.copy(fontSize = 15.sp, lineHeight = 20.sp)
    val PlaceDistance = LycorisTypography.bodyLarge.copy(fontSize = 15.sp)
    val PlaceDescription = LycorisTypography.bodyLarge.copy(lineHeight = 23.sp)
    val Search = LycorisTypography.bodyLarge
    val Attribution = LycorisTypography.bodyLarge.copy(fontSize = 11.sp, lineHeight = 14.sp)
}
