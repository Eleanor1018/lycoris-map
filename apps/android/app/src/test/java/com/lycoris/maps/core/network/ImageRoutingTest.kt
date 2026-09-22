package com.lycoris.maps.core.network

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.Cookie
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class ImageRoutingTest {
    @Test fun productionApprovedImagesUseWorkerButPrivateImagesKeepApiOrigin() {
        val clients = clients("https://api.lycoris-map.com/".toHttpUrl())
        val approved = clients.resolveImage("/uploads/markers/photo.jpg?variant=original&token=discard", ImageVariant.THUMB, true)!!
        assertEquals("https://lycoris-map.com/uploads/markers/photo.jpg?variant=thumb", approved.url.toString())
        assertFalse(approved.mayNeedSession)
        val private = clients.resolveImage("https://lycoris-map.com/uploads/markers/photo.jpg", ImageVariant.DETAIL, false)!!
        assertEquals("https://api.lycoris-map.com/uploads/markers/photo.jpg?variant=detail", private.url.toString())
        assertTrue(private.mayNeedSession)
        assertEquals("https://lycoris-map.com/uploads/avatars/photo.png", clients.resolveImage("/uploads/avatars/photo.png", publiclyVisible = true)!!.url.toString())
        assertNull(clients.resolveImage("https://untrusted.example/uploads/markers/photo.jpg", publiclyVisible = true))
        assertNull(clients.resolveImage("https://lycoris-map.com:8443/uploads/markers/photo.jpg", publiclyVisible = true))
        assertNull(clients.resolveImage("https://person:secret@lycoris-map.com/uploads/markers/photo.jpg", publiclyVisible = true))
        assertNull(clients.resolveImage("//lycoris-map.com/uploads/markers/photo.jpg", publiclyVisible = true))
        assertNull(clients.resolveImage("/uploads/markers/photo.jpg#fragment", publiclyVisible = true))
        assertNull(clients.resolveImage("/uploads/markers/dir%2Fphoto.jpg", publiclyVisible = true))
        assertNull(clients.resolveImage("/uploads/markers/photo.html", publiclyVisible = true))
        assertNull(clients.resolveImage("/api/me", publiclyVisible = true))
    }

    @Test fun qaImagesCannotEscapeToProductionEvenWhenMarkedPublic() {
        val origin = "http://10.0.2.2:18187/".toHttpUrl()
        val clients = clients(origin, testEnvironment = true)
        for (public in listOf(true, false)) {
            val resource = clients.resolveImage("/uploads/markers/photo.jpg", ImageVariant.DETAIL, public)!!
            assertEquals("http://10.0.2.2:18187/uploads/markers/photo.jpg?variant=detail", resource.url.toString())
            assertEquals(!public, resource.mayNeedSession)
            assertNull(clients.resolveImage("https://lycoris-map.com/uploads/markers/photo.jpg", publiclyVisible = public))
            assertNull(clients.resolveImage("https://api.lycoris-map.com/uploads/markers/photo.jpg", publiclyVisible = public))
        }
    }

    @Test fun publicMediaDoesNotSendOrPersistCredentials() {
        MockWebServer().use { server ->
            server.start()
            val clients = clients(server.url("/"))
            val jar = clients.cookies
            jar.saveFromResponse(server.url("/"), listOf(Cookie.parse(server.url("/"), "session=private; Path=/; Max-Age=600")!!))
            server.enqueue(MockResponse().setBody("image").addHeader("Set-Cookie", "session=wrong; Path=/; Max-Age=600"))
            clients.publicMediaClient.newCall(Request.Builder().url(server.url("/uploads/markers/photo.jpg?variant=thumb"))
                .header("Cookie", "manual=secret").header("Authorization", "Bearer secret")
                .header("Proxy-Authorization", "Basic secret").header("Referer", "https://private.example/")
                .header("Origin", "https://private.example").build()).execute().use { assertEquals("image", it.body.string()) }
            val request = server.takeRequest(2, TimeUnit.SECONDS)!!
            for (header in listOf("Cookie", "Authorization", "Proxy-Authorization", "Referer", "Origin")) assertNull(request.getHeader(header))
            assertEquals("LycorisAndroid/Test", request.getHeader("User-Agent"))
            assertEquals("private", jar.loadForRequest(server.url("/")).single().value)
        }
    }

    @Test fun publicMediaRejectsOtherOriginsPathsMethodsAndUnknownQueryBeforeNetwork() {
        MockWebServer().use { server ->
            server.start()
            val clients = clients(server.url("/"))
            val requests = listOf(
                Request.Builder().url("https://untrusted.example/uploads/markers/photo.jpg").build(),
                Request.Builder().url(server.url("/api/me")).build(),
                Request.Builder().url(server.url("/uploads/markers/photo.svg")).build(),
                Request.Builder().url(server.url("/uploads/markers/photo.jpg?token=secret")).build(),
                Request.Builder().url(server.url("/uploads/markers/photo.jpg?variant=unknown")).build(),
                Request.Builder().url(server.url("/uploads/markers/photo.jpg?variant=thumb&variant=detail")).build(),
                Request.Builder().url(server.url("/uploads/markers/photo.jpg")).post(ByteArray(0).toRequestBody()).build(),
            )
            requests.forEach { request ->
                try { clients.publicMediaClient.newCall(request).execute().close(); fail("Unsafe image request was sent") } catch (_: IOException) { }
            }
            assertEquals(0, server.requestCount)
        }
    }

    @Test fun publicMediaDoesNotFollowRedirectsAndApiOriginLockRemainsStrict() {
        MockWebServer().use { server ->
            MockWebServer().use { other ->
                server.start(); other.start()
                val clients = clients(server.url("/"))
                server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", other.url("/uploads/markers/photo.jpg")))
                clients.publicMediaClient.newCall(Request.Builder().url(server.url("/uploads/markers/photo.jpg")).build()).execute().use {
                    assertEquals(302, it.code)
                }
                assertEquals(0, other.requestCount)
                val production = this.clients("https://api.lycoris-map.com/".toHttpUrl())
                try {
                    production.publicClient.newCall(Request.Builder().url("https://lycoris-map.com/uploads/markers/photo.jpg").build()).execute().close()
                    fail("API client must not accept the separate media origin")
                } catch (_: IOException) { }
            }
        }
    }

    @Test fun imageResponsesAndTimeoutsAreBounded() {
        MockWebServer().use { server ->
            server.start()
            val client = clients(server.url("/")).publicMediaClient
            assertEquals(15_000, client.connectTimeoutMillis)
            assertEquals(20_000, client.readTimeoutMillis)
            assertEquals(35_000, client.callTimeoutMillis)
            val request = Request.Builder().url(server.url("/uploads/markers/photo.jpg")).build()
            server.enqueue(MockResponse().setResponseCode(403).setBody("x".repeat(10_000)))
            client.newCall(request).execute().use { assertEquals(8192, it.body.bytes().size) }
            server.enqueue(MockResponse().setBody("x").setHeader("Content-Length", 16L * 1024 * 1024 + 1))
            try { client.newCall(request).execute().close(); fail("Oversized image must fail") } catch (_: ApiFailure.InvalidResponse) { }
            server.enqueue(MockResponse().setChunkedBody("x".repeat(16 * 1024 * 1024 + 1), 8192))
            try {
                client.newCall(request).execute().use { it.body.bytes() }
                fail("Chunked oversized image must fail")
            } catch (_: ApiFailure.InvalidResponse) { }
        }
    }

    private fun clients(origin: HttpUrl, testEnvironment: Boolean = false) =
        ApiClients(origin.toString(), SessionCookieJar(origin, MemoryCookiePersistence()), "LycorisAndroid/Test", testEnvironment = testEnvironment)
}
