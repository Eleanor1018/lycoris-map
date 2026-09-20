package com.lycoris.maps.core.network

import java.io.IOException
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test

class QaEnvironmentGuardTest {
    private val manifest = QaManifest(
        QA_ENVIRONMENT, 1, "a".repeat(64), "http://127.0.0.1:18186/",
        QaSentinel(1, "Android QA Environment Sentinel v1", "Synthetic Android QA only. Never production data.", "11111111-2222-3333-4444-555555555555", "android-qa-sentinel-v1"),
    )

    @Test fun requiresExactSentinelAndFreshNonceShape() {
        assertEquals("a".repeat(64), manifest.verifiedNonce())
        for (invalid in listOf(
            manifest.copy(testEnvironment = "production"),
            manifest.copy(instanceNonce = "short"),
            manifest.copy(upstream = "https://api.lycoris-map.com/"),
            manifest.copy(sentinel = manifest.sentinel.copy(title = "Real place")),
            manifest.copy(sentinel = manifest.sentinel.copy(ownerPublicId = "invalid")),
            manifest.copy(sentinel = manifest.sentinel.copy(markerId = 0)),
        )) {
            try { invalid.verifiedNonce(); fail("Expected rejection") } catch (_: IOException) { }
        }
    }

    @Test fun productionAndDirectBackendOriginsAreRejected() {
        for (url in listOf("https://api.lycoris-map.com/", "http://10.0.2.2:18186/", "http://example.com:18187/")) {
            try { QaEnvironmentGuard(url.toHttpUrl(), "test"); fail("Expected rejection") } catch (_: IllegalArgumentException) { }
        }
        QaEnvironmentGuard("http://10.0.2.2:18187/".toHttpUrl(), "test")
    }
}
