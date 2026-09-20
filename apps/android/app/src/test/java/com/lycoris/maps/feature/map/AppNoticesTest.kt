package com.lycoris.maps.feature.map

import org.junit.Assert.*
import org.junit.Test

class AppNoticesTest {
    @Test fun lateMapAndAutomaticLocationFailuresCannotHideSpeechFallback() {
        val notices = AppNotices()
        notices.showAction("On-device speech input is unavailable")
        notices.showBackground("Map request failed")
        notices.showBackground("Location timed out")
        assertEquals("On-device speech input is unavailable", notices.state.value)
    }

    @Test fun speechFallbackReplacesAnEarlierBackgroundFailure() {
        val notices = AppNotices()
        notices.showBackground("Map request failed")
        notices.showAction("On-device speech input is unavailable")
        assertEquals("On-device speech input is unavailable", notices.state.value)
    }

    @Test fun dismissDoesNotReplayDroppedErrorsAndLaterBackgroundFailuresCanStillShow() {
        val notices = AppNotices()
        notices.showAction("Speech fallback")
        notices.showBackground("Stale request failure")
        notices.showAction(null)
        assertNull(notices.state.value)
        notices.showBackground("New request failure")
        assertEquals("New request failure", notices.state.value)
    }

    @Test fun newExplicitActionCanReplaceAnEarlierActionNotice() {
        val notices = AppNotices()
        notices.showAction("Speech fallback")
        notices.showAction("Could not save this bookmark")
        assertEquals("Could not save this bookmark", notices.state.value)
    }
}
