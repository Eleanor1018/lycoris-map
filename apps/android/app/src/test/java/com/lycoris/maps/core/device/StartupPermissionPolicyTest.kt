package com.lycoris.maps.core.device

import org.junit.Assert.*
import org.junit.Test

class StartupPermissionPolicyTest {
    private data class Startup(
        val foreground: Boolean = true,
        val inFlight: Boolean = false,
        val otherDialog: Boolean = false,
        val hasLocation: Boolean = false,
        val locationRequested: Boolean = false,
        val needsLan: Boolean = true,
        val hasLan: Boolean = false,
        val lanRequested: Boolean = false,
    ) {
        fun next() = StartupPermissionPolicy.next(foreground, inFlight, otherDialog,
            hasLocation, locationRequested, needsLan, hasLan, lanRequested)
    }

    @Test fun `first foreground startup asks location before QA network`() {
        val fresh = Startup()
        assertEquals(StartupPermission.LOCATION, fresh.next())
        val locationDialog = fresh.copy(locationRequested = true, inFlight = true)
        assertNull(locationDialog.next())
        // The retained in-flight state still blocks LAN after Activity recreation/resume.
        assertNull(locationDialog.copy(foreground = false).next())
        assertNull(locationDialog.copy(foreground = true).next())
        val locationAllowed = locationDialog.copy(inFlight = false, hasLocation = true)
        assertEquals(StartupPermission.QA_LOCAL_NETWORK, locationAllowed.next())
        assertNull(locationAllowed.copy(lanRequested = true, inFlight = true).next())
        assertNull(locationAllowed.copy(lanRequested = true, hasLan = true).next())
    }

    @Test fun `denying either request does not cause a startup or resume loop`() {
        val locationDenied = Startup(locationRequested = true)
        assertEquals(StartupPermission.QA_LOCAL_NETWORK, locationDenied.next())
        val bothDenied = locationDenied.copy(lanRequested = true)
        repeat(3) {
            assertNull(bothDenied.copy(foreground = false).next())
            assertNull(bothDenied.copy(foreground = true).next())
        }
        // Revocation after an earlier handled grant is treated the same as denial.
        assertNull(Startup(locationRequested = true, lanRequested = true, hasLocation = false, hasLan = false).next())
    }

    @Test fun `coarse or previously granted location does not prompt again`() {
        assertEquals(StartupPermission.QA_LOCAL_NETWORK, Startup(hasLocation = true).next())
        assertNull(Startup(hasLocation = true, hasLan = true).next())
        assertEquals(StartupPermission.LOCATION, Startup(hasLan = true).next())
    }

    @Test fun `preview release and older QA never request local network`() {
        for (sdk in listOf(26, 31, 36, 37, 38)) {
            for (qa in listOf(false, true)) {
                val required = StartupPermissionPolicy.requiresQaLocalNetwork(qa, sdk)
                assertEquals(qa && sdk >= 37, required)
                val next = Startup(hasLocation = true, needsLan = required).next()
                if (required) assertEquals(StartupPermission.QA_LOCAL_NETWORK, next) else assertNull(next)
            }
        }
    }

    @Test fun `background another permission or settings dialog pauses the queue`() {
        for (base in listOf(Startup(), Startup(locationRequested = true))) {
            assertNull(base.copy(foreground = false).next())
            assertNull(base.copy(inFlight = true).next())
            assertNull(base.copy(otherDialog = true).next())
        }
    }
}
