package com.lycoris.maps.core.map

import com.lycoris.maps.core.model.GeoBounds
import com.lycoris.maps.core.model.Language
import org.junit.Assert.*
import org.junit.Test

class ViewportPolicyTest {
    private val initial = GeoBounds(31.0, 31.1, 121.0, 121.1)
    @Test fun smallPanAndZoomReuseSuccessfulCoverage() {
        val policy = ViewportPolicy()
        val request = policy.request(initial, 12.1, Language.EN)!!
        policy.complete(request, true)
        assertNull(policy.request(GeoBounds(31.01, 31.11, 121.01, 121.11), 13.8, Language.EN))
        assertNotNull(policy.request(initial, 14.0, Language.EN))
    }
    @Test fun failureDoesNotSuppressRetryOrPromoteCoverage() {
        val policy = ViewportPolicy()
        val request = policy.request(initial, 13.0, Language.EN)!!
        policy.complete(request, false)
        assertNotNull(policy.request(initial, 13.0, Language.EN))
    }
    @Test fun oldCompletionCannotMarkNewRegionSuccessful() {
        val policy = ViewportPolicy()
        val old = policy.request(initial, 13.0, Language.EN)!!
        val next = policy.request(GeoBounds(20.0, 20.1, 110.0, 110.1), 13.0, Language.EN)!!
        policy.complete(old, true)
        policy.complete(next, false)
        assertNotNull(policy.request(next.bounds, 13.0, Language.EN))
    }
    @Test fun returningToPreviousRegionSupersedesPendingRemoteRequest() {
        val policy = ViewportPolicy()
        val first = policy.request(initial, 13.0, Language.EN)!!
        policy.complete(first, true)
        policy.request(GeoBounds(20.0, 20.1, 110.0, 110.1), 13.0, Language.EN)!!
        assertNotNull(policy.request(initial, 13.0, Language.EN))
    }
    @Test fun dateLinePaddingRetainsWrappedCoverage() {
        val policy = ViewportPolicy()
        val request = policy.request(GeoBounds(-2.0, 2.0, 179.0, -179.0), 5.0, Language.EN)!!
        assertTrue(request.bounds.west > request.bounds.east)
        policy.complete(request, true)
        assertNull(policy.request(GeoBounds(-1.0, 1.0, 179.5, -179.5), 5.0, Language.EN))
        assertNotNull(policy.request(GeoBounds(-1.0, 1.0, 179.5, -179.5), 5.0, Language.ZH))
    }
}
