package com.lycoris.maps.core.data

import com.lycoris.maps.core.model.GeoBounds
import com.lycoris.maps.core.model.Language
import com.lycoris.maps.core.model.PlaceCategory
import com.lycoris.maps.core.data.preferences.SearchType
import com.lycoris.maps.core.network.ApiClients
import com.lycoris.maps.core.network.ApiFailure
import com.lycoris.maps.core.network.MemoryCookiePersistence
import com.lycoris.maps.core.network.SessionCookieJar
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.Cookie
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.*
import org.junit.Test

class PlaceRepositoryTest {
    private val bounds = GeoBounds(30.0, 32.0, 120.0, 122.0)
    private val place = """{"id":1,"lat":31.2,"lng":121.5,"category":"baby_room","title":"Synthetic"}"""

    private fun withRepository(block: suspend (MockWebServer, PlaceRepository) -> Unit) = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val clients = ApiClients(server.url("/").toString(), SessionCookieJar(server.url("/"), MemoryCookiePersistence()), "LycorisAndroid/Test")
            try { block(server, PlaceRepository(clients.publicApi, scope)) } finally { scope.cancel() }
        }
    }

    @Test fun viewportRetainsOnFailureButSuccessfulEmptyClears() = withRepository { server, repository ->
        server.enqueue(MockResponse().setBody("[$place]"))
        repository.loadViewport(bounds, Language.EN).join()
        assertEquals(PlaceCategory.BABY_ROOM, repository.viewport.value.places.single().placeCategory)
        server.enqueue(MockResponse().setResponseCode(503))
        repository.loadViewport(GeoBounds(30.0, 32.0, 121.0, 123.0), Language.EN).join()
        assertEquals(1, repository.viewport.value.places.size)
        assertTrue(repository.viewport.value.failure is ApiFailure.Http)
        server.enqueue(MockResponse().setBody("[]"))
        repository.loadViewport(bounds, Language.EN).join()
        assertTrue(repository.viewport.value.loaded)
        assertTrue(repository.viewport.value.places.isEmpty())
    }

    @Test fun changingLanguageNeverShowsOldLanguageAfterFailure() = withRepository { server, repository ->
        server.enqueue(MockResponse().setBody("[$place]"))
        repository.loadViewport(bounds, Language.EN).join()
        server.enqueue(MockResponse().setResponseCode(503))
        repository.loadViewport(bounds, Language.ZH).join()
        assertTrue(repository.viewport.value.places.isEmpty())
        assertFalse(repository.viewport.value.loaded)
    }

    @Test fun inaccessibleDetailIsPrunedAndCannotResurrectFromViewport() = withRepository { server, repository ->
        server.enqueue(MockResponse().setBody("[$place]"))
        repository.loadViewport(bounds, Language.EN).join()
        server.enqueue(MockResponse().setResponseCode(404))
        repository.loadDetail(1, Language.EN).join()
        assertTrue(repository.detail.value.missing)
        assertTrue(repository.viewport.value.places.isEmpty())
        server.enqueue(MockResponse().setBody("[$place]"))
        repository.loadViewport(bounds, Language.EN).join()
        assertTrue(repository.viewport.value.places.isEmpty())
    }

    @Test fun slowSearchCannotOverwriteLatestOrClearViewport() = withRepository { server, repository ->
        server.enqueue(MockResponse().setBody("[$place]"))
        repository.loadViewport(bounds, Language.EN).join()
        server.takeRequest()
        server.enqueue(MockResponse().setBody("[$place]").setBodyDelay(300, TimeUnit.MILLISECONDS))
        val old = repository.search("first", Language.EN, debounceMillis = 0)
        assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
        server.enqueue(MockResponse().setBody("[]"))
        repository.search("second", Language.EN, debounceMillis = 0).join()
        old.join()
        assertTrue(repository.search.value.loaded)
        assertEquals("second", repository.search.value.query)
        assertTrue(repository.search.value.places.isEmpty())
        assertEquals(1, repository.viewport.value.places.size)
    }

    @Test fun nearbyRequestPathAndQueryMatchTheSelectedCategory() = withRepository { server, repository ->
        for (category in listOf(PlaceCategory.ACCESSIBLE_TOILET, PlaceCategory.BABY_ROOM, PlaceCategory.FRIENDLY_CLINIC)) {
            server.enqueue(MockResponse().setBody("[${place.replace("baby_room", category.wireValue)}]"))
            repository.loadNearby(31.2, 121.5, 1500, category, Language.EN).join()
            assertEquals(category, repository.nearby.value.places.single().placeCategory)
            val url = requireNotNull(server.takeRequest(2, TimeUnit.SECONDS)).requestUrl!!
            assertEquals("/api/markers/nearby", url.encodedPath)
            assertEquals("31.2", url.queryParameter("lat"))
            assertEquals("121.5", url.queryParameter("lng"))
            assertEquals("1500", url.queryParameter("radius"))
            assertEquals(category.wireValue, url.queryParameter("category"))
            assertEquals("en", url.queryParameter("lang"))
        }
    }

    @Test fun nearbyDistinguishesEmptySuccessFromFailureAndRetryRecovers() = withRepository { server, repository ->
        server.enqueue(MockResponse().setBody("[]"))
        repository.loadNearby(31.2, 121.5, 1000, PlaceCategory.BABY_ROOM, Language.EN).join()
        assertTrue("after empty: ${repository.nearby.value}", repository.nearby.value.loaded)
        assertTrue(repository.nearby.value.places.isEmpty())
        assertNull("after empty: ${repository.nearby.value}", repository.nearby.value.failure)

        server.enqueue(MockResponse().setResponseCode(503))
        repository.loadNearby(31.2, 121.5, 1000, PlaceCategory.BABY_ROOM, Language.EN).join()
        assertTrue("after 503: ${repository.nearby.value}", repository.nearby.value.failure is ApiFailure.Http)
        assertTrue(repository.nearby.value.places.isEmpty())

        server.enqueue(MockResponse().setBody("[$place]"))
        repository.loadNearby(31.2, 121.5, 1000, PlaceCategory.BABY_ROOM, Language.EN).join()
        assertNull(repository.nearby.value.failure)
        assertTrue(repository.nearby.value.loaded)
        assertEquals(1, repository.nearby.value.places.size)
    }

    @Test fun fastCategorySwitchKeepsTheLatestCategoryResult() = withRepository { server, repository ->
        val toilet = place.replace("baby_room", "accessible_toilet")
        val medical = place.replace("baby_room", "friendly_clinic")
        // The first category's response is slow; switching quickly must not let it overwrite the second.
        server.enqueue(MockResponse().setBody("[$toilet]").setBodyDelay(300, TimeUnit.MILLISECONDS))
        val first = repository.loadNearby(31.2, 121.5, 1000, PlaceCategory.ACCESSIBLE_TOILET, Language.EN)
        assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
        server.enqueue(MockResponse().setBody("[$medical]"))
        repository.loadNearby(31.2, 121.5, 1000, PlaceCategory.FRIENDLY_CLINIC, Language.EN).join()
        first.join()
        assertEquals(PlaceCategory.FRIENDLY_CLINIC, repository.nearby.value.places.single().placeCategory)
        assertTrue(repository.nearby.value.loaded)
        assertNull(repository.nearby.value.failure)
    }

    @Test fun crossingDateLineMakesTwoRequestsAndDeduplicates() = withRepository { server, repository ->
        server.enqueue(MockResponse().setBody("[$place]"))
        server.enqueue(MockResponse().setBody("[$place]"))
        repository.loadViewport(GeoBounds(-10.0, 10.0, 175.0, -175.0), Language.EN).join()
        assertEquals(1, repository.viewport.value.places.size)
        val requests = listOf(server.takeRequest(), server.takeRequest()).map { it.requestUrl!! }
        assertEquals(setOf("175.0", "-180.0"), requests.map { it.queryParameter("minLng") }.toSet())
        assertEquals(setOf("180.0", "-175.0"), requests.map { it.queryParameter("maxLng") }.toSet())
    }

    @Test fun searchTypeRefiltersWithoutRequestsAndLeavesNearbyAndViewportUnchanged() = withRepository { server, repository ->
        val categories = listOf("accessible_toilet", "baby_room", "friendly_clinic", "custom_category")
        val response = categories.mapIndexed { index, category ->
            """{"id":${index + 1},"lat":31.2,"lng":121.5,"category":"$category","title":"Synthetic $index"}"""
        }.joinToString(",", "[", "]")
        repeat(3) { server.enqueue(MockResponse().setBody(response)) }
        repository.loadViewport(bounds, Language.EN).join()
        repository.loadNearby(31.2, 121.5, 1000, PlaceCategory.BABY_ROOM, Language.EN).join()
        repository.search("Synthetic", Language.EN, debounceMillis = 0).join()
        val types = MutableStateFlow(SearchType.ALL)
        val results = repository.searchResults(types)
        assertEquals(listOf(1L, 2L, 3L, 4L), results.first().places.map { it.id })
        for ((type, id) in listOf(SearchType.TOILET to 1L, SearchType.NURSING to 2L, SearchType.MEDICAL to 3L)) {
            types.value = type
            val filtered = results.first()
            assertEquals(listOf(id), filtered.places.map { it.id })
            assertEquals("Synthetic", filtered.query)
            assertTrue(filtered.loaded)
        }
        types.value = SearchType.ALL
        assertEquals(4, results.first().places.size)
        assertEquals(4, repository.search.value.places.size)
        assertEquals(4, repository.viewport.value.places.size)
        assertEquals(4, repository.nearby.value.places.size)
        assertEquals(3, server.requestCount)
    }

    @Test fun pendingSearchUsesLatestTypeAndPreservesFailureState() = withRepository { server, repository ->
        val medical = place.replace("\"id\":1", "\"id\":2").replace("baby_room", "friendly_clinic")
        val types = MutableStateFlow(SearchType.NURSING)
        val results = repository.searchResults(types)
        server.enqueue(MockResponse().setBody("[$place,$medical]").setBodyDelay(200, TimeUnit.MILLISECONDS))
        val request = repository.search("Synthetic", Language.EN, debounceMillis = 0)
        assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
        assertTrue(results.first().loading)
        types.value = SearchType.MEDICAL
        request.join()
        assertEquals(listOf(2L), results.first().places.map { it.id })
        server.enqueue(MockResponse().setResponseCode(503))
        repository.search("Synthetic", Language.EN, debounceMillis = 0).join()
        types.value = SearchType.NURSING
        val failed = results.first()
        assertEquals(listOf(1L), failed.places.map { it.id })
        assertTrue(failed.failure is ApiFailure.Http)
        assertFalse(failed.loading)
        assertEquals(2, server.requestCount)
    }

    @Test fun coldPrivateDetailWaitsForRestoreAndCannotPoisonCreatedPlaces() = runBlocking {
        MockWebServer().use { server ->
            val privatePlace = place.dropLast(1) + ",\"isPublic\":false,\"reviewStatus\":\"PENDING\"}"
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (request.requestUrl!!.encodedPath) {
                    "/api/me" -> MockResponse().setBody("""{"code":0,"data":{"publicId":"owner"}}""").setBodyDelay(500, TimeUnit.MILLISECONDS)
                    "/api/markers/1" -> if (request.getHeader("Cookie") == "session=owner") MockResponse().setBody(privatePlace) else MockResponse().setResponseCode(404)
                    "/api/markers/me/created" -> MockResponse().setBody("[$privatePlace]")
                    else -> MockResponse().setResponseCode(404)
                }
            }
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val jar = SessionCookieJar(server.url("/"), MemoryCookiePersistence())
            jar.saveFromResponse(server.url("/"), listOf(Cookie.parse(server.url("/"), "session=owner; Path=/; Max-Age=600")!!))
            val clients = ApiClients(server.url("/").toString(), jar, "LycorisAndroid/Test")
            val accounts = AccountRepository(clients, scope)
            try {
                val restore = scope.async { accounts.restore() }
                assertEquals("/api/me", server.takeRequest(2, TimeUnit.SECONDS)!!.path)
                assertTrue(accounts.state.value.busy)
                assertFalse(accounts.state.value.initialized)
                val repository = PlaceRepository(clients.publicApi, scope, accounts)
                val detail = repository.loadDetail(1, Language.EN)
                assertNull("No anonymous marker request may race /me", server.takeRequest(80, TimeUnit.MILLISECONDS))
                withTimeout(2_000) { restore.await(); detail.join() }
                assertEquals(1L, repository.detail.value.place?.id)
                assertFalse(repository.detail.value.missing)
                assertFalse(repository.detail.value.place!!.publiclyVisible)
                accounts.refreshCreated(Language.EN)
                assertEquals(1L, accounts.state.value.createdPlaces.single().id)
            } finally { scope.cancel() }
        }
    }

    @Test fun failedRestoreDoesNotTurnIts404IntoAMissingPlaceOrHangDetails() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val jar = SessionCookieJar(server.url("/"), MemoryCookiePersistence())
            jar.saveFromResponse(server.url("/"), listOf(Cookie.parse(server.url("/"), "session=owner; Path=/; Max-Age=600")!!))
            val clients = ApiClients(server.url("/").toString(), jar, "LycorisAndroid/Test")
            val accounts = AccountRepository(clients, scope)
            try {
                server.enqueue(MockResponse().setResponseCode(404))
                accounts.restore()
                val repository = PlaceRepository(clients.publicApi, scope, accounts)
                withTimeout(2_000) { repository.loadDetail(1, Language.EN).join() }
                assertFalse(repository.detail.value.loading)
                assertFalse(repository.detail.value.missing)
                assertTrue(repository.detail.value.failure is ApiFailure.Http)
                assertEquals(1, server.requestCount)
                assertTrue(jar.hasCookies())
                assertTrue(accounts.state.value.initialized)
                assertFalse(accounts.state.value.busy)
            } finally { scope.cancel() }
        }
    }

    @Test fun oldAccountDetailCannotPublishAfterNewAccountReceivesReal404() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val clients = ApiClients(server.url("/").toString(), SessionCookieJar(server.url("/"), MemoryCookiePersistence()), "LycorisAndroid/Test")
            val accounts = AccountRepository(clients, scope)
            try {
                server.enqueue(MockResponse().setBody("""{"code":0,"data":{"publicId":"owner-a"}}"""))
                accounts.login("owner-a", "synthetic")
                server.takeRequest()
                val repository = PlaceRepository(clients.publicApi, scope, accounts)
                server.enqueue(MockResponse().setBody(place.dropLast(1) + ",\"isPublic\":false}").setBodyDelay(500, TimeUnit.MILLISECONDS))
                val oldDetail = repository.loadDetail(1, Language.EN)
                assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
                server.enqueue(MockResponse().setBody("""{"code":0,"data":{"publicId":"owner-b"}}"""))
                accounts.login("owner-b", "synthetic")
                withTimeout(2_000) { repository.detail.first { it.id == null }; oldDetail.join() }
                server.enqueue(MockResponse().setResponseCode(404))
                withTimeout(2_000) { repository.loadDetail(1, Language.EN).join() }
                assertTrue(repository.detail.value.missing)
                assertNull(repository.detail.value.place)
                // A stale list from this same account must still respect a genuine detail 404.
                server.enqueue(MockResponse().setBody("[$place]"))
                accounts.refreshCreated(Language.EN)
                assertTrue(accounts.state.value.createdPlaces.isEmpty())
                assertEquals("owner-b", accounts.state.value.user?.publicId)
            } finally { scope.cancel() }
        }
    }
}
