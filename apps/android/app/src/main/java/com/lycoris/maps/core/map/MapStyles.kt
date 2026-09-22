package com.lycoris.maps.core.map

/** Raster providers share geographic camera/overlays; Tianditu's w matrix is Web Mercator. */
object MapStyles {
    val osmSources = setOf("osm")
    val tiandituSources = setOf("tianditu-vector", "tianditu-labels")

    val osm = """
        {"version":8,"sources":{"osm":{"type":"raster","tiles":["https://lycoris-map.com/tiles/osm/{z}/{x}/{y}.png"],"tileSize":256,"maxzoom":19,"attribution":"© OpenStreetMap contributors"}},"layers":[{"id":"background","type":"background","paint":{"background-color":"#F3F0F5"}},{"id":"osm","type":"raster","source":"osm"}]}
    """.trimIndent()

    fun tianditu(key: String): String {
        require(key.matches(Regex("[A-Fa-f0-9]{32}"))) { "Tianditu Maps requires a configured key" }
        fun tiles(layer: String) = "https://t0.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=$layer&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=$key"
        return """
            {"version":8,"sources":{
                "tianditu-vector":{"type":"raster","tiles":["${tiles("vec")}"],"tileSize":256,"minzoom":1,"maxzoom":18,"attribution":"© 天地图"},
                "tianditu-labels":{"type":"raster","tiles":["${tiles("cva")}"],"tileSize":256,"minzoom":1,"maxzoom":19,"attribution":"© 天地图"}
            },"layers":[
                {"id":"background","type":"background","paint":{"background-color":"#F3F0F5"}},
                {"id":"tianditu-vector","type":"raster","source":"tianditu-vector"},
                {"id":"tianditu-labels","type":"raster","source":"tianditu-labels"}
            ]}
        """.trimIndent()
    }
}
