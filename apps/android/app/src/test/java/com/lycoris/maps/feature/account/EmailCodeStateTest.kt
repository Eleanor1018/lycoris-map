package com.lycoris.maps.feature.account

import com.lycoris.maps.core.network.ApiFailure
import org.junit.Assert.*
import org.junit.Test

class EmailCodeStateTest {
    @Test fun sendingQuotaDoesNotExtendTheVerificationLock() {
        var now = 1_000L
        val state = EmailCodeState { now }
        state.applyCooldown(ApiFailure.Http(429, 42932, retryAfterSeconds = 7200))
        assertFalse(state.locked)
        state.applyCooldown(ApiFailure.Http(429, 42931, retryAfterSeconds = 3600))
        assertTrue(state.locked)

        now += 3_600_000
        state.tick()
        // Existing codes can be verified again even while new email remains rate limited.
        assertFalse(state.locked)
        assertEquals(3600L, state.remaining)
    }
}
