package com.lycoris.maps.core.network

import okhttp3.Protocol
import okhttp3.Request
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import retrofit2.Response

class ApiFailureTest {
    private fun failure(body: String, retryAfter: String? = null, status: Int = 429): ApiFailure.Http {
        val raw = okhttp3.Response.Builder()
            .request(Request.Builder().url("https://example.test/").build())
            .protocol(Protocol.HTTP_1_1).code(status).message("Synthetic failure")
        retryAfter?.let { raw.header("Retry-After", it) }
        return try {
            Response.error<Unit>(body.toResponseBody(), raw.build()).requireSuccess()
            error("Expected HTTP failure")
        } catch (error: ApiFailure.Http) { error }
    }

    @Test fun retryHeaderTakesPrecedenceOverBody() {
        val error = failure("""{"code":42931,"data":{"retryAfterSeconds":3600}}""", "3598")
        assertEquals(429, error.status)
        assertEquals(42931, error.serviceCode)
        assertEquals(3598, error.retryAfterSeconds)
    }

    @Test fun absentOrInvalidRetryHeaderFallsBackToPositiveBodySeconds() {
        for (header in listOf(null, "invalid", "0", "-1", "2147483648")) {
            val error = failure("""{"code":42932,"data":{"retryAfterSeconds":45}}""", header)
            assertEquals(45, error.retryAfterSeconds)
        }
    }

    @Test fun malformedCooldownDataKeepsTheOriginalHttpError() {
        for (data in listOf("null", "[]", "{}", """{"retryAfterSeconds":null}""",
            """{"retryAfterSeconds":-1}""", """{"retryAfterSeconds":0}""",
            """{"retryAfterSeconds":1.5}""", """{"retryAfterSeconds":"60"}""",
            """{"retryAfterSeconds":2147483648}""")) {
            val error = failure("""{"code":42931,"message":"locked","data":$data}""")
            assertEquals(42931, error.serviceCode)
            assertEquals("locked", error.serviceMessage)
            assertNull(error.retryAfterSeconds)
        }
        assertNull(failure("<html>unavailable</html>").retryAfterSeconds)
    }

    @Test fun unrelatedErrorDataDoesNotStartVerificationCooldown() {
        val error = failure("""{"code":40021,"data":{"retryAfterSeconds":60}}""", status = 400)
        assertEquals(40021, error.serviceCode)
        assertNull(error.retryAfterSeconds)
    }
}
