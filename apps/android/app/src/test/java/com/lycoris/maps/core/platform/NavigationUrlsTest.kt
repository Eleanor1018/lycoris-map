package com.lycoris.maps.core.platform

import java.net.URI
import java.net.URLDecoder
import java.util.Locale
import org.junit.Assert.*
import org.junit.Test

class NavigationUrlsTest {
    private val urls = NavigationUrls(NavigationCoordinates(realCoverage()))
    private val destination = NavigationDestination(7, "母婴室 & 医疗 / test", 31.2304, 121.4737)
    private fun query(url: String): Map<String, String> = URI(url).rawQuery.split('&').associate {
        val pair = it.split('=', limit = 2)
        URLDecoder.decode(pair[0], "UTF-8") to URLDecoder.decode(pair[1], "UTF-8")
    }

    @Test fun `AMap and Tencent receive GCJ only at the navigation boundary`() {
        val amap = urls.amap(destination)
        assertTrue(amap.startsWith("amapuri://route/plan/?"))
        val fields = query(amap)
        assertEquals("31.2284577", fields["dlat"])
        assertEquals("121.4782231", fields["dlon"])
        assertEquals("0", fields["dev"])
        assertEquals("2", fields["t"])
        assertEquals(destination.title, fields["dname"])
        assertFalse(fields.containsKey("slat"))
        assertFalse(fields.containsKey("slon"))
        assertFalse(fields.containsKey("sname"))
        val tencent = query(urls.tencent(destination, "TEST-KEY-NOT-A-LIVE-SECRET")!!)
        assertEquals("31.2284577,121.4782231", tencent["tocoord"])
        assertEquals("CurrentLocation", tencent["fromcoord"])
        assertEquals("walk", tencent["type"])
        assertEquals(31.2304, destination.latitude, 0.0)
        assertEquals(121.4737, destination.longitude, 0.0)
    }

    @Test fun `Tencent route is unavailable without a configured key`() {
        assertNull(urls.tencent(destination, null))
        assertNull(urls.tencent(destination, ""))
        assertNull(urls.tencent(destination, "not a key"))
        assertNull(urls.tencent(destination, "key&fromcoord=1,2"))
        assertNull(NavigationUrls(null).tencent(destination, "TEST-KEY-NOT-A-LIVE-SECRET"))
    }

    @Test fun `Baidu labels cannot add second structured destination fields`() {
        val malicious = destination.copy(title = "Clinic|latlng:0,0&mode=driving#x")
        val fields = query(urls.baidu(malicious))
        assertEquals("bd09ll", fields["coord_type"])
        assertEquals("walking", fields["mode"])
        assertEquals(5, fields.size)
        assertEquals(1, fields.getValue("destination").count { it == '|' })
        assertTrue(fields.getValue("destination").contains("Clinic｜latlng：0,0&mode=driving#x"))
        assertEquals("我的位置", fields["origin"])
    }

    @Test fun `outside mainland providers do not accidentally apply the regional shift`() {
        val outside = NavigationDestination(8, "Seoul", 37.5665, 126.9780)
        assertEquals("37.5665000", query(urls.amap(outside))["dlat"])
        assertEquals("126.9780000", query(urls.amap(outside))["dlon"])
        assertEquals("wgs84", query(urls.baidu(outside))["coord_type"])
        assertEquals("latlng:37.5665000,126.9780000|name:Seoul", query(urls.baidu(outside))["destination"])
        assertEquals("37.5665000,126.9780000", query(urls.tencent(outside, "TEST-KEY-NOT-A-LIVE-SECRET")!!)["tocoord"])
    }

    @Test fun `missing conversion asset uses supported native WGS84 flags not a rectangular guess`() {
        val unavailable = NavigationUrls(null)
        assertEquals("1", query(unavailable.amap(destination))["dev"])
        assertEquals("31.2304000", query(unavailable.amap(destination))["dlat"])
        assertEquals("wgs84", query(unavailable.baidu(destination))["coord_type"])
    }

    @Test fun `generic and Google routes stay WGS84 and contain no user origin`() {
        val generic = urls.generic(destination)
        assertTrue(generic.startsWith("geo:31.2304000,121.4737000?q="))
        val decoded = URLDecoder.decode(generic.substringAfter("?q="), "UTF-8")
        assertEquals("31.2304000,121.4737000(${destination.title})", decoded)
        assertEquals("google.navigation:q=31.2304000%2C121.4737000&mode=w", urls.google(destination))
        assertFalse(generic.contains("origin="))
        assertFalse(urls.google(destination).contains("origin="))
    }

    @Test fun `decimal formatting ignores the users locale`() {
        val previous = Locale.getDefault()
        try {
            Locale.setDefault(Locale.GERMANY)
            assertEquals("31.2284577", query(urls.amap(destination))["dlat"])
            assertTrue(urls.webFallback(destination).contains("mlat=31.2304000&mlon=121.4737000"))
        } finally { Locale.setDefault(previous) }
    }

    @Test fun `fallback is fixed HTTPS OSM host with destination only`() {
        val uri = URI(urls.webFallback(destination))
        assertEquals("https", uri.scheme)
        assertEquals("www.openstreetmap.org", uri.host)
        assertNull(uri.userInfo)
        assertEquals(setOf("mlat", "mlon"), query(uri.toString()).keys)
        assertEquals("map=17/31.2304000/121.4737000", uri.fragment)
        assertFalse(uri.toString().contains(destination.title))
    }

    @Test fun `invalid destinations never enter Android intents`() {
        assertThrows(IllegalArgumentException::class.java) { NavigationDestination(0, "x", 1.0, 2.0) }
        assertThrows(IllegalArgumentException::class.java) { NavigationDestination(1, "x", Double.NaN, 2.0) }
        assertThrows(IllegalArgumentException::class.java) { NavigationDestination(1, "x", 1.0, Double.POSITIVE_INFINITY) }
        assertThrows(IllegalArgumentException::class.java) { NavigationDestination(1, "x", 1.0, 181.0) }
        val label = NavigationDestination(1, "\r\nName (test)\u0000", 1.0, 2.0)
        assertEquals("Name (test)", label.displayTitle)
        assertTrue(URLDecoder.decode(urls.generic(label), "UTF-8").contains("Name （test）"))
    }
}
