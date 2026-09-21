package com.lycoris.maps.core.model

import com.lycoris.maps.core.network.LycorisJson
import java.time.Instant
import java.util.TimeZone
import org.junit.Assert.*
import org.junit.Test

class PlaceMetadataTest {
    private val place = Marker(1, 31.2, 121.5, "accessible_toilet", "Test", openTimeStart = "09:00", openTimeEnd = "22:00", hoursTimezone = "Asia/Shanghai")
    private fun status(iso: String, value: Marker = place) = value.openingStatus(Instant.parse(iso))

    @Test fun warningStartsThirtyMinutesBeforeClosingAndEndsAtClosing() {
        assertEquals(OpeningStatus.OPEN, status("2026-09-20T13:29:59Z"))
        assertEquals(OpeningStatus.CLOSING_SOON, status("2026-09-20T13:30:00Z"))
        assertEquals(OpeningStatus.CLOSING_SOON, status("2026-09-20T13:59:59Z"))
        assertEquals(OpeningStatus.CLOSED, status("2026-09-20T14:00:00Z"))
        assertEquals(OpeningStatus.CLOSED, status("2026-09-20T00:59:59Z"))
        assertEquals(OpeningStatus.OPEN, status("2026-09-20T01:00:00Z"))
    }

    @Test fun overnightMidnightAndEqualTimesFollowApiSemantics() {
        val overnight = place.copy(openTimeStart = "22:00", openTimeEnd = "06:00")
        assertEquals(OpeningStatus.OPEN, status("2026-09-20T15:59:59Z", overnight))
        assertEquals(OpeningStatus.CLOSING_SOON, status("2026-09-20T21:30:00Z", overnight))
        assertEquals(OpeningStatus.CLOSED, status("2026-09-20T22:00:00Z", overnight))
        assertEquals(OpeningStatus.CLOSING_SOON, status("2026-09-20T15:30:00Z", place.copy(openTimeEnd = "00:00")))
        val allDay = place.copy(openTimeEnd = "09:00", hoursTimezone = null)
        assertEquals(OpeningStatus.OPEN, status("2026-09-20T00:45:00Z", allDay))
        assertEquals("全天开放", allDay.hoursLabel(true))
        assertEquals("Open 24 hours", allDay.hoursLabel(false))
    }

    @Test fun missingOrInvalidHoursAndZoneNeverInventAnOpenStatus() {
        val now = "2026-09-20T13:45:00Z"
        assertEquals(OpeningStatus.UNKNOWN, status(now, place.copy(openTimeStart = null)))
        assertEquals(OpeningStatus.UNKNOWN, status(now, place.copy(openTimeEnd = "24:00")))
        assertEquals(OpeningStatus.UNKNOWN, status(now, place.copy(openTimeStart = "9:00")))
        assertNull(place.copy(openTimeEnd = "24:00").hoursLabel(false))
        assertEquals(OpeningStatus.SCHEDULED, status(now, place.copy(hoursTimezone = null)))
        assertEquals(OpeningStatus.SCHEDULED, status(now, place.copy(hoursTimezone = "not-a-zone")))
    }

    @Test fun serverZoneAndDaylightSavingWinOverDeviceZone() {
        val old = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Honolulu"))
            assertEquals(OpeningStatus.CLOSING_SOON, status("2026-09-20T13:45:00Z"))
            val ny = place.copy(hoursTimezone = "America/New_York")
            assertEquals(OpeningStatus.CLOSING_SOON, status("2026-07-02T01:45:00Z", ny))
            assertEquals(OpeningStatus.CLOSING_SOON, status("2026-01-02T02:45:00Z", ny))
        } finally { TimeZone.setDefault(old) }
    }

    @Test fun readContractPreservesMetadataWithoutInventingLegacyOrUnknownTags() {
        val legacy = """{"id":1,"lat":31.2,"lng":121.5,"category":"accessible_toilet","title":"Test"}"""
        assertNull(LycorisJson.decodeFromString<Marker>(legacy).venue)
        assertNull(LycorisJson.decodeFromString<Marker>(legacy).hoursTimezone)
        VenueType.entries.forEach { venue ->
            val marker = LycorisJson.decodeFromString<Marker>(legacy.dropLast(1) + """, "venueType":"${venue.wireValue}","hoursTimezone":"Asia/Shanghai"}""")
            assertEquals(venue, marker.venue)
            assertEquals("Asia/Shanghai", marker.hoursTimezone)
        }
        assertNull(place.copy(venueType = "future-type").venue)
        assertNull(place.copy(category = "baby_room", venueType = "metro").venue)
    }
}
