package com.lycoris.maps.core.designsystem

import android.content.Context
import android.graphics.Typeface
import com.lycoris.maps.R

/** Shares the packaged medium face across native map renderers without retaining a Context. */
internal object LycorisNativeFonts {
    private var mediumTypeface: Typeface? = null

    @Synchronized
    fun medium(context: Context): Typeface = mediumTypeface
        ?: context.applicationContext.resources.getFont(R.font.lycoris_medium).also { mediumTypeface = it }
}
