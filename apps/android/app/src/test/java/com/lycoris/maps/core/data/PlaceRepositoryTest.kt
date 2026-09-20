package com.lycoris.maps.core.data

import com.lycoris.maps.core.model.GeoBounds
import com.lycoris.maps.core.model.Language
import com.lycoris.maps.core.model.PlaceCategory
import com.lycoris.maps.core.network.ApiClients
import com.lycoris.maps.core.network.ApiFailure
import com.lycoris.maps.core.network.MemoryCookiePersistence
import com.lycoris.maps.core.network.SessionCookieJar
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
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

    @Test fun crossingDateLineMakesTwoRequestsAndDeduplicates() = withRepository { server, repository ->
        server.enqueue(MockResponse().setBody("[$place]"))
        server.enqueue(MockResponse().setBody("[$place]"))
        repository.loadViewport(GeoBounds(-10.0, 10.0, 175.0, -175.0), Language.EN).join()
        assertEquals(1, repository.viewport.value.places.size)
        val requests = listOf(server.takeRequest(), server.takeRequest()).map { it.requestUrl!! }
        assertEquals(setOf("175.0", "-180.0"), requests.map { it.queryParameter("minLng") }.toSet())
        assertEquals(setOf("180.0", "-175.0"), requests.map { it.queryParameter("maxLng") }.toSet())
    }
}
