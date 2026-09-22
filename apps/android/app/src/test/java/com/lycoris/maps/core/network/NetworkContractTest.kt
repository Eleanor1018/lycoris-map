package com.lycoris.maps.core.network

import com.lycoris.maps.core.model.GeoBounds
import com.lycoris.maps.core.model.Marker
import com.lycoris.maps.core.model.PlaceCategory
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class NetworkContractTest {
    @Test fun unknownCategoryAndInt64IdsSurviveDecoding() {
        val marker = LycorisJson.decodeFromString<Marker>("""{"id":9007199254740993,"lat":31.2,"lng":121.5,"category":"future_category","title":"Test","unexpected":true}""")
        assertEquals(9007199254740993L, marker.id)
        assertEquals(PlaceCategory.OTHER, marker.placeCategory)
        assertTrue(marker.hasValidLocation)
        assertEquals(PlaceCategory.OTHER, PlaceCategory.fromWire("dangerous_place"))
    }

    @Test fun datelineSplitsWithoutLosingEdges() {
        assertEquals(
            listOf(GeoBounds(-20.0, 20.0, 175.0, 180.0), GeoBounds(-20.0, 20.0, -180.0, -175.0)),
            GeoBounds(-20.0, 20.0, 175.0, -175.0).segments(),
        )
    }

    @Test fun jarHonorsOriginPathExpiryAndSecurePersistentRules() {
        val origin = "https://api.example.com/".toHttpUrl()
        var time = 1000L
        val persistence = MemoryCookiePersistence()
        val jar = SessionCookieJar(origin, persistence) { time }
        val persistent = Cookie.Builder().name("session").value("secret").hostOnlyDomain(origin.host)
            .path("/api").secure().httpOnly().expiresAt(5000).build()
        val sessionOnly = Cookie.Builder().name("temporary").value("x").hostOnlyDomain(origin.host).build()
        jar.saveFromResponse(origin, listOf(persistent, sessionOnly))
        assertEquals(2, jar.loadForRequest(origin.resolve("/api/me")!!).size)
        assertEquals(listOf("temporary"), jar.loadForRequest(origin.resolve("/uploads/avatar")!!).map { it.name })
        assertTrue(jar.loadForRequest("https://api.example.com:8443/api/me".toHttpUrl()).isEmpty())
        assertTrue(jar.loadForRequest("https://images.example.com/api/me".toHttpUrl()).isEmpty())
        assertTrue(jar.loadForRequest("http://api.example.com/api/me".toHttpUrl()).isEmpty())
        val restored = SessionCookieJar(origin, persistence) { time }
        assertEquals(listOf("session"), restored.loadForRequest(origin.resolve("/api/me")!!).map { it.name })
        time = 5001
        assertTrue(restored.loadForRequest(origin.resolve("/api/me")!!).isEmpty())
    }

    @Test fun oldResponsesCannotResurrectSessionAfterLogout() {
        val origin = "https://api.example.com/".toHttpUrl()
        val jar = SessionCookieJar(origin, MemoryCookiePersistence())
        val epoch = jar.epoch()
        val cookie = Cookie.parse(origin, "session=secret; Path=/; Max-Age=600; Secure; HttpOnly")!!
        jar.saveFromResponse(origin, listOf(cookie), epoch)
        assertTrue(jar.hasCookies())
        jar.advanceEpoch(clear = true)
        jar.saveFromResponse(origin, listOf(cookie), epoch)
        assertFalse(jar.hasCookies())
    }

    @Test fun deletingCookieIsPersisted() {
        val origin = "https://api.example.com/".toHttpUrl()
        val storage = MemoryCookiePersistence()
        val jar = SessionCookieJar(origin, storage)
        jar.saveFromResponse(origin, listOf(Cookie.parse(origin, "session=x; Path=/; Max-Age=600")!!))
        jar.saveFromResponse(origin, listOf(Cookie.parse(origin, "session=; Path=/; Max-Age=0")!!))
        assertFalse(jar.hasCookies())
        assertFalse(SessionCookieJar(origin, storage).hasCookies())
    }

    @Test fun mediaResolverUsesOnlyDocumentedVariantsAndSafeOrigins() {
        val resolver = MediaUrlResolver("https://api.example.com/".toHttpUrl(), setOf("media.example.com"))
        val photo = resolver.resolve("/uploads/markers/image.jpg", ImageVariant.THUMB)!!
        assertEquals("https://api.example.com/uploads/markers/image.jpg?variant=thumb", photo.url.toString())
        assertTrue(photo.mayNeedSession)
        assertFalse(resolver.resolve("/api/users/abc/avatar")!!.mayNeedSession)
        assertNull(resolver.resolve("//evil.example/image.jpg"))
        assertNull(resolver.resolve("https://evil.example/image.jpg"))
        assertNull(resolver.resolve("javascript:alert(1)"))
        assertNull(resolver.resolve("/api/me"))
        assertNull(resolver.resolve("https://user:pass@media.example.com/photo.jpg"))
        assertNull(resolver.resolve("http://media.example.com/photo.jpg"))
        assertEquals("https://media.example.com/photo.jpg?sig=a", resolver.resolve("https://media.example.com/photo.jpg?sig=a", ImageVariant.THUMB)!!.url.toString())
    }

    @Test fun publicRequestsAreCookieFreeAndPrivateRequestsKeepSession() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val jar = SessionCookieJar(server.url("/"), MemoryCookiePersistence())
            jar.saveFromResponse(server.url("/"), listOf(Cookie.parse(server.url("/"), "session=synthetic; Path=/; Max-Age=600")!!))
            val clients = ApiClients(server.url("/").toString(), jar, "LycorisAndroid/Test")
            server.enqueue(MockResponse().setBody("[]"))
            clients.publicApi.publicMarkers("en").requireBody()
            val public = server.takeRequest(2, TimeUnit.SECONDS)!!
            assertNull(public.getHeader("Cookie"))
            assertNull(public.getHeader("Origin"))
            assertNull(public.getHeader("Referer"))
            assertEquals("LycorisAndroid/Test", public.getHeader("User-Agent"))
            server.enqueue(MockResponse().setBody("""{"code":0,"data":{"publicId":"user-a"}}"""))
            clients.authenticatedApi(jar.epoch()).me().requireUserData()
            assertEquals("session=synthetic", server.takeRequest(2, TimeUnit.SECONDS)!!.getHeader("Cookie"))
        }
    }

    @Test fun retiredApiCannotBorrowNextEpochCookies() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val jar = SessionCookieJar(server.url("/"), MemoryCookiePersistence())
            val clients = ApiClients(server.url("/").toString(), jar, "LycorisAndroid/Test")
            val oldApi = clients.authenticatedApi(jar.epoch())
            jar.advanceEpoch(clear = true)
            try {
                apiCall { oldApi.me().requireUserData() }
                fail("Old API must be rejected before a request is sent")
            } catch (_: ApiFailure.SessionChanged) { }
            assertEquals(0, server.requestCount)
        }
    }

    @Test fun emptyFavoriteSuccessAndMixedErrorsAreHandled() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val jar = SessionCookieJar(server.url("/"), MemoryCookiePersistence())
            val api = ApiClients(server.url("/").toString(), jar, "LycorisAndroid/Test").authenticatedApi(jar.epoch())
            server.enqueue(MockResponse().setResponseCode(200))
            api.addFavorite(9007199254740993L).requireSuccess()
            assertEquals("/api/markers/9007199254740993/favorite", server.takeRequest().path)
            server.enqueue(MockResponse().setResponseCode(503).setHeader("X-Request-ID", "request-123").setBody("service unavailable"))
            val failure = try { api.me().requireUserData(); error("Expected HTTP error") } catch (error: ApiFailure.Http) { error }
            assertEquals(503, failure.status)
            assertEquals("request-123", failure.requestId)
            assertNull(failure.serviceMessage)
            server.enqueue(MockResponse().setResponseCode(401).setBody("""{"code":4001,"message":"Invalid credentials","data":null}"""))
            val auth = try { api.me().requireUserData(); error("Expected HTTP error") } catch (error: ApiFailure.Http) { error }
            assertEquals(4001, auth.serviceCode)
            assertEquals("Invalid credentials", auth.serviceMessage)
            server.enqueue(MockResponse().setResponseCode(403).setHeader("X-Request-ID", "large-error").setBody("x".repeat(1024 * 1024)))
            val bounded = try { api.me().requireUserData(); error("Expected HTTP error") } catch (error: ApiFailure.Http) { error }
            assertEquals(403, bounded.status)
            assertEquals("large-error", bounded.requestId)
        }
    }

    @Test fun frozenContributionBytesAreSentExactlyAsPersisted() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val jar = SessionCookieJar(server.url("/"), MemoryCookiePersistence())
            val api = ApiClients(server.url("/").toString(), jar, "LycorisAndroid/Test").authenticatedApi(jar.epoch())
            val frozen = """{ "title": "测试", "clientRequestId":"synthetic-id", "lat":31.20000, "lng":121.50000 }""".encodeToByteArray()
            server.enqueue(MockResponse().setBody("""{"id":9007199254740993,"lat":31.2,"lng":121.5,"category":"baby_room","title":"测试","reviewStatus":"PENDING"}"""))
            val result = api.createMarkerBytes(frozen.toRequestBody("application/json".toMediaType()), "zh").requireBody()
            assertEquals("PENDING", result.reviewStatus)
            val request = server.takeRequest()
            assertEquals("/api/markers?lang=zh", request.path)
            assertArrayEquals(frozen, request.body.readByteArray())
        }
    }
}
