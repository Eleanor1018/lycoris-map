package com.lycoris.maps.core.designsystem

import androidx.compose.foundation.Image
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import coil3.compose.rememberAsyncImagePainter
import coil3.request.ImageRequest
import coil3.svg.SvgDecoder

object LycorisColors {
    val Surface = Color(0xFFF3EDF7)
    val Card = Color(0xFFE8DEF8)
    val Text = Color(0xFF1D1B20)
    val SecondaryText = Color(0xFF49454F)
    val Primary = Color(0xFF6750A4)
    val Plum = Color(0xFF5A3850)
    val Blue = Color(0xFF0C79FE)
    val Orange = Color(0xFFFEA90C)
    val Green = Color(0xFF1FBC00)
}

@Composable
fun LycorisTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = LycorisColors.Primary,
            onPrimary = Color.White,
            surface = LycorisColors.Surface,
            surfaceContainer = LycorisColors.Surface,
            secondaryContainer = LycorisColors.Card,
            onSurface = LycorisColors.Text,
            onSurfaceVariant = LycorisColors.SecondaryText,
            background = LycorisColors.Surface,
        ),
        typography = Typography(),
        content = content,
    )
}

/** Exact exported Figma bytes. Decorative icons inherit the surrounding button's semantics. */
@Composable
fun FigmaIcon(name: String, modifier: Modifier = Modifier, description: String? = null) {
    val context = LocalContext.current
    Image(
        painter = rememberAsyncImagePainter(
            ImageRequest.Builder(context).data("file:///android_asset/figma/$name.svg")
                .decoderFactory(SvgDecoder.Factory()).build(),
        ),
        contentDescription = description,
        modifier = modifier,
    )
}
