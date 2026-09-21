package com.lycoris.maps.core.map

import java.net.URI
import kotlinx.serialization.json.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MapStylesTest {
    @Test fun tiandituUsesMatchingMercatorBaseAndLabelsWithXyzRowsAndColumns() {
        val style = Json.parseToJsonElement(MapStyles.tianditu("0".repeat(32))).jsonObject
        val sources = style.getValue("sources").jsonObject
        assertEquals(MapStyles.tiandituSources, sources.keys)
        for ((id, layer) in mapOf("tianditu-vector" to "vec", "tianditu-labels" to "cva")) {
            val source = sources.getValue(id).jsonObject
            val url = source.getValue("tiles").jsonArray.single().jsonPrimitive.content
                .replace("{z}", "13").replace("{x}", "6860").replace("{y}", "3347")
            val uri = URI(url)
            assertEquals("https", uri.scheme)
            assertEquals("t0.tianditu.gov.cn", uri.host)
            assertEquals("/${layer}_w/wmts", uri.path)
            val query = uri.query.split("&").associate { it.substringBefore("=") to it.substringAfter("=") }
            assertEquals(layer, query["LAYER"])
            assertEquals("w", query["TILEMATRIXSET"])
            assertEquals("13", query["TILEMATRIX"])
            assertEquals("6860", query["TILECOL"])
            assertEquals("3347", query["TILEROW"])
            assertEquals(256, source.getValue("tileSize").jsonPrimitive.int)
            assertEquals(if (layer == "vec") 18 else 19, source.getValue("maxzoom").jsonPrimitive.int)
            assertTrue(source.getValue("attribution").jsonPrimitive.content.contains("天地图"))
        }
        assertEquals(listOf("background", "tianditu-vector", "tianditu-labels"),
            style.getValue("layers").jsonArray.map { it.jsonObject.getValue("id").jsonPrimitive.content })
    }

    @Test(expected = IllegalArgumentException::class)
    fun unconfiguredTiandituCannotGenerateAnonymousRequests() { MapStyles.tianditu("") }
}
