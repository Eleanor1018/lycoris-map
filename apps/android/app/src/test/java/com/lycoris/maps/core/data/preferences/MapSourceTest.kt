package com.lycoris.maps.core.data.preferences

import com.lycoris.maps.core.model.Language
import org.junit.Assert.assertEquals
import org.junit.Test

class MapSourceTest {
    private val available = setOf(MapSource.OSM, MapSource.TENCENT, MapSource.GOOGLE)

    @Test fun untouchedSourceFollowsCurrentLanguage() {
        assertEquals(MapSource.OSM, resolveMapSource(null, Language.EN, available))
        assertEquals(MapSource.TENCENT, resolveMapSource(null, Language.ZH, available))
        assertEquals(MapSource.OSM, resolveMapSource(null, Language.EN, available))
    }

    @Test fun explicitChoicesSurviveLanguageChangesIncludingChoosingTheExistingDefault() {
        for (source in available) for (language in Language.entries) {
            assertEquals(source, resolveMapSource(source.name, language, available))
        }
    }

    @Test fun unavailableOrUnknownChoicesUseTheLanguageDefaultWithoutChangingTheSavedChoice() {
        assertEquals(MapSource.TENCENT, resolveMapSource("legacy", Language.ZH, available))
        assertEquals(MapSource.TENCENT, resolveMapSource("TIANDITU", Language.ZH, available))
        assertEquals(MapSource.OSM, resolveMapSource("TENCENT", Language.ZH, setOf(MapSource.OSM)))
        assertEquals(MapSource.TENCENT, resolveMapSource("TENCENT", Language.EN, available))
        assertEquals(MapSource.OSM, resolveMapSource(null, Language.ZH, setOf(MapSource.OSM)))
    }
}
