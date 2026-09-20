package com.lycoris.maps.core.platform

import org.junit.Assert.*
import org.junit.Test

class PlaceLinkTest {
    @Test fun `canonical web share links and iOS custom links preserve full id precision`() {
        for (id in listOf(1L, 7L, 9_007_199_254_740_993L, Long.MAX_VALUE)) {
            assertEquals(id, PlaceLink.parse(PlaceLink.shareUrl(id))?.markerId)
            assertEquals(id, PlaceLink.parse(PlaceLink.shareUrl(id, "zh"))?.markerId)
            assertEquals(id, PlaceLink.parse("lycoris://maps?markerId=$id&lang=en")?.markerId)
        }
        assertEquals(7L, PlaceLink.parse("lycoris://maps/?lang=zh&markerId=7")?.markerId)
        assertEquals(7L, PlaceLink.parse("https://LYCORIS-MAP.COM/maps?markerId=7")?.markerId)
    }

    @Test fun `userinfo ports fragments deceptive authorities and wrong routes are rejected`() {
        val bad = listOf(
            "https://lycoris-map.com.evil.test/maps?markerId=1",
            "https://evil.test@lycoris-map.com/maps?markerId=1",
            "https://lycoris-map.com@evil.test/maps?markerId=1",
            "https://lycoris-map.com:443/maps?markerId=1",
            "https://lycoris-map.com:/maps?markerId=1",
            "https://lycoris-map.com./maps?markerId=1",
            "https://lycoris-map%2ecom/maps?markerId=1",
            "https://lycoris-map.com/maps?markerId=1#",
            "https://lycoris-map.com/maps?markerId=1#other",
            "http://lycoris-map.com/maps?markerId=1",
            "https://lycoris.online/maps?markerId=1",
            "https://preview.pages.dev/maps?markerId=1",
            "https://lycoris-map.com/%6daps?markerId=1",
            "https://lycoris-map.com/maps/../maps?markerId=1",
            "https://lycoris-map.com/maps/other?markerId=1",
            "lycoris://user@maps?markerId=1", "lycoris://maps:80?markerId=1",
            "lycoris://maps/other?markerId=1", "lycoris:maps?markerId=1",
            "intent://maps?markerId=1", "https://lycoris-map.com\\@evil.test/maps?markerId=1",
        )
        bad.forEach { assertNull(it, PlaceLink.parse(it)) }
    }

    @Test fun `ambiguous conflicting encoded duplicate and invalid query ids are rejected`() {
        val badQueries = listOf(
            "", "markerId", "markerId=", "markerId=0", "markerId=-1", "markerId=01", "markerId=1.0",
            "markerId=1e3", "markerId=+1", "markerId=%2B1", "markerId=%201", "markerId=１",
            "markerId=9223372036854775808", "markerId=1&markerId=2", "markerId=1&%6darkerId=2",
            "markerId=1&lang=en&lang=zh", "markerId=1&lang=fr", "markerId=1&lang=",
            "markerId=1&panel=settings", "markerId=1&id=2", "markerId=1&token=secret",
            "markerId=1&", "markerId=1&&lang=en", "markerId=1=2", "markerId=%ZZ", "markerId=1%00",
        )
        badQueries.forEach { assertNull(it, PlaceLink.parse("https://lycoris-map.com/maps?$it")) }
        assertNull(PlaceLink.parse(null))
        assertNull(PlaceLink.parse(" https://lycoris-map.com/maps?markerId=1"))
    }

    @Test fun `share is canonical and refuses invalid ids or unrecognized language`() {
        assertEquals("https://lycoris-map.com/maps?markerId=9&lang=en", PlaceLink.shareUrl(9, "en"))
        assertThrows(IllegalArgumentException::class.java) { PlaceLink.shareUrl(0) }
        assertThrows(IllegalArgumentException::class.java) { PlaceLink.shareUrl(-1) }
        assertThrows(IllegalArgumentException::class.java) { PlaceLink.shareUrl(1, "en&token=bad") }
    }
}
