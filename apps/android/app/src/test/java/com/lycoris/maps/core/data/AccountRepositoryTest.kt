package com.lycoris.maps.core.data

import com.lycoris.maps.core.model.Language
import com.lycoris.maps.core.network.ApiClients
import com.lycoris.maps.core.network.ApiFailure
import com.lycoris.maps.core.network.MemoryCookiePersistence
import com.lycoris.maps.core.network.SessionCookieJar
import java.util.concurrent.TimeUnit
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class AccountRepositoryTest {
    private val userA = """{"code":0,"data":{"publicId":"user-a","nickname":"Synthetic A"}}"""
    private val userB = """{"code":0,"data":{"publicId":"user-b","nickname":"Synthetic B"}}"""
    private val marker = """{"id":1,"lat":31.2,"lng":121.5,"category":"baby_room","title":"Synthetic"}"""

    private fun withRepository(block: suspend (MockWebServer, AccountRepository, SessionCookieJar) -> Unit) = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val jar = SessionCookieJar(server.url("/"), MemoryCookiePersistence())
            val clients = ApiClients(server.url("/").toString(), jar, "LycorisAndroid/Test")
            try { block(server, AccountRepository(clients, scope), jar) } finally { scope.cancel() }
        }
    }

    private suspend fun login(server: MockWebServer, repository: AccountRepository) {
        server.enqueue(MockResponse().setBody(userA).setHeader("Set-Cookie", "session=synthetic-a; Path=/; Max-Age=600; HttpOnly"))
        repository.login("synthetic-a", "synthetic-password")
        assertEquals("/api/login", server.takeRequest().path)
    }

    @Test fun loginFailureDoesNotPreservePriorIdentityOrCookies() = withRepository { server, repository, jar ->
        login(server, repository)
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"code":4001,"message":"Invalid credentials"}"""))
        try { repository.login("synthetic-b", "incorrect"); fail("Expected failure") } catch (_: ApiFailure.Http) { }
        assertNull(repository.state.value.user)
        assertFalse(jar.hasCookies())
        assertTrue(repository.state.value.failure is ApiFailure.Http)
    }

    @Test fun serviceFailureDoesNotPretendServerLoggedOut() = withRepository { server, repository, jar ->
        login(server, repository)
        val epoch = repository.state.value.epoch
        server.enqueue(MockResponse().setResponseCode(503))
        try { repository.logout(); fail("Expected failure") } catch (_: ApiFailure.Http) { }
        assertEquals("user-a", repository.state.value.user?.publicId)
        assertEquals(epoch, repository.state.value.epoch)
        assertTrue(jar.hasCookies())
    }

    @Test fun successfulLogoutClearsEveryPrivateListAndSession() = withRepository { server, repository, jar ->
        login(server, repository)
        server.enqueue(MockResponse().setBody("[1]"))
        server.enqueue(MockResponse().setBody("[$marker]"))
        repository.refreshFavorites(Language.EN)
        assertEquals(setOf(1L), repository.state.value.favoriteIds)
        assertEquals(1, repository.state.value.favoritePlaces.size)
        server.enqueue(MockResponse().setBody("""{"code":0,"data":null}""").setHeader("Set-Cookie", "session=; Path=/; Max-Age=0"))
        repository.logout()
        assertNull(repository.state.value.user)
        assertTrue(repository.state.value.favoriteIds.isEmpty())
        assertTrue(repository.state.value.favoritePlaces.isEmpty())
        assertTrue(repository.state.value.createdPlaces.isEmpty())
        assertFalse(jar.hasCookies())
    }

    @Test fun switchingAccountCannotKeepFavoriteCache() = withRepository { server, repository, _ ->
        login(server, repository)
        server.enqueue(MockResponse().setBody("[1]"))
        server.enqueue(MockResponse().setBody("[$marker]"))
        repository.refreshFavorites(Language.EN)
        server.enqueue(MockResponse().setBody(userB).setHeader("Set-Cookie", "session=synthetic-b; Path=/; Max-Age=600"))
        repository.login("synthetic-b", "synthetic-password")
        assertEquals("user-b", repository.state.value.user?.publicId)
        assertTrue(repository.state.value.favoriteIds.isEmpty())
        assertTrue(repository.state.value.favoritePlaces.isEmpty())
    }

    @Test fun firstToggleReadsAuthoritativeIdsAndHandlesEmptyDeleteSuccess() = withRepository { server, repository, _ ->
        login(server, repository)
        server.enqueue(MockResponse().setBody("[1]"))
        server.enqueue(MockResponse().setResponseCode(200))
        server.enqueue(MockResponse().setBody("[]"))
        server.enqueue(MockResponse().setBody("[]"))
        repository.toggleFavorite(1, Language.EN)
        assertTrue(repository.state.value.favoriteIds.isEmpty())
        assertTrue(repository.state.value.pendingFavoriteIds.isEmpty())
        assertTrue(repository.state.value.favoritesInitialized)
        assertEquals("GET", server.takeRequest().method)
        val write = server.takeRequest()
        assertEquals("DELETE", write.method)
        assertEquals("/api/markers/1/favorite", write.path)
    }

    @Test fun delayedFavoriteReadCannotOverwriteToggle() = withRepository { server, repository, _ ->
        login(server, repository)
        // Establish an empty initial favorite set.
        server.enqueue(MockResponse().setBody("[]"))
        server.enqueue(MockResponse().setBody("[]"))
        repository.refreshFavorites(Language.EN)
        server.takeRequest(); server.takeRequest()
        // The refresh's IDs are stale; hold only its details body while the mutation completes.
        server.enqueue(MockResponse().setBody("[]"))
        server.enqueue(MockResponse().setBody("[]").setBodyDelay(500, TimeUnit.MILLISECONDS))
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val old = scope.async { repository.refreshFavorites(Language.EN) }
            assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
            assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
            server.enqueue(MockResponse().setBody("[]")) // Toggle first reconciles IDs while refresh is incomplete.
            server.enqueue(MockResponse().setResponseCode(200))
            server.enqueue(MockResponse().setBody("[1]"))
            server.enqueue(MockResponse().setBody("[$marker]"))
            repository.toggleFavorite(1, Language.EN)
            old.await()
            assertEquals(setOf(1L), repository.state.value.favoriteIds)
            assertEquals(1L, repository.state.value.favoritePlaces.single().id)
        } finally { scope.cancel() }
    }

    @Test fun authenticated401ClearsIdentityWhere503DoesNot() = withRepository { server, repository, jar ->
        login(server, repository)
        server.enqueue(MockResponse().setResponseCode(503))
        repository.refreshFavorites(Language.EN)
        assertEquals("user-a", repository.state.value.user?.publicId)
        server.enqueue(MockResponse().setResponseCode(401))
        try { repository.refreshFavorites(Language.EN) } catch (_: kotlinx.coroutines.CancellationException) { }
        assertNull(repository.state.value.user)
        assertFalse(jar.hasCookies())
        assertTrue(repository.state.value.failure is ApiFailure.SessionRequired)
    }

    @Test fun ownerBoundMutationRejectsAnotherAccountBeforeNetwork() = withRepository { server, repository, _ ->
        login(server, repository)
        val count = server.requestCount
        try {
            repository.withAuthenticatedMutation(expectedOwner = "user-b") { _, _ -> fail("Must not run") }
            fail("Expected owner mismatch")
        } catch (_: ApiFailure.SessionChanged) { }
        assertEquals(count, server.requestCount)
    }

    @Test fun oldEpochMutationRejectsEvenWhenSameUserSignsInAgain() = withRepository { server, repository, _ ->
        login(server, repository)
        val old = repository.identity()!!
        login(server, repository)
        val count = server.requestCount
        try {
            repository.withAuthenticatedMutation(expectedIdentity = old) { _, _ -> fail("Must not run") }
            fail("Expected epoch mismatch")
        } catch (_: ApiFailure.SessionChanged) { }
        assertEquals(count, server.requestCount)
    }

    @Test fun importedAvatarCannotBeAppliedAfterAccountChanges() = withRepository { server, repository, _ ->
        login(server, repository)
        val pickerIdentity = repository.identity()!!
        server.enqueue(MockResponse().setBody(userB).setHeader("Set-Cookie", "session=synthetic-b; Path=/; Max-Age=600"))
        repository.login("synthetic-b", "synthetic-password")
        val file = File.createTempFile("synthetic-avatar-", ".jpg").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        val count = server.requestCount
        try {
            try { repository.uploadAvatar(file, "image/jpeg", expectedIdentity = pickerIdentity); fail("Expected stale picker rejection") }
            catch (_: ApiFailure.SessionChanged) { }
            assertEquals(count, server.requestCount)
            assertEquals("user-b", repository.state.value.user?.publicId)
        } finally { file.delete() }
    }

    @Test fun profileAndPasswordFormsCannotWriteAfterAccountChanges() = withRepository { server, repository, _ ->
        login(server, repository)
        val formIdentity = repository.identity()!!
        server.enqueue(MockResponse().setBody(userB).setHeader("Set-Cookie", "session=synthetic-b; Path=/; Max-Age=600"))
        repository.login("synthetic-b", "synthetic-password")
        val count = server.requestCount
        try { repository.updateProfile("Old account name", "", "", expectedIdentity = formIdentity); fail("Expected stale form rejection") }
        catch (_: ApiFailure.SessionChanged) { }
        try { repository.changePassword("old-synthetic", "new-synthetic", expectedIdentity = formIdentity); fail("Expected stale password rejection") }
        catch (_: ApiFailure.SessionChanged) { }
        assertEquals(count, server.requestCount)
        assertEquals("user-b", repository.state.value.user?.publicId)
    }

    @Test fun cancellingLoginCannotRestoreSessionOrPublishNetworkFailure() = withRepository { server, repository, jar ->
        server.enqueue(MockResponse().setBody(userA).setHeader("Set-Cookie", "session=cancelled-synthetic; Path=/; Max-Age=600")
            .setBodyDelay(600, TimeUnit.MILLISECONDS))
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val login = scope.async { repository.login("synthetic-a", "synthetic-password") }
            assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
            login.cancelAndJoin()
            assertNull(repository.state.value.user)
            assertNull(repository.state.value.failure)
            assertFalse(repository.state.value.busy)
            assertFalse(jar.hasCookies())
        } finally { scope.cancel() }
    }

    @Test fun failedFavoriteRefreshCannotExposeAConfidentToggleState() = withRepository { server, repository, _ ->
        login(server, repository)
        server.enqueue(MockResponse().setBody("[1]"))
        server.enqueue(MockResponse().setBody("[$marker]"))
        repository.refreshFavorites(Language.EN)
        assertTrue(repository.state.value.favoritesInitialized)
        server.enqueue(MockResponse().setResponseCode(503))
        repository.refreshFavorites(Language.EN)
        assertFalse(repository.state.value.favoritesInitialized)
        assertEquals(setOf(1L), repository.state.value.favoriteIds)
        assertEquals(1, repository.state.value.favoritePlaces.size)
    }

    @Test fun changingPrivateLanguageInvalidatesFavoriteInitializationUntilReconciled() = withRepository { server, repository, _ ->
        login(server, repository)
        server.enqueue(MockResponse().setBody("[1]"))
        server.enqueue(MockResponse().setBody("[$marker]"))
        repository.refreshFavorites(Language.EN)
        assertTrue(repository.state.value.favoritesInitialized)
        server.enqueue(MockResponse().setBody("[]"))
        repository.refreshCreated(Language.ZH)
        assertFalse(repository.state.value.favoritesInitialized)
        assertTrue(repository.state.value.favoritePlaces.isEmpty())
        server.enqueue(MockResponse().setBody("[1]"))
        server.enqueue(MockResponse().setBody("[$marker]"))
        repository.refreshFavorites(Language.ZH)
        assertTrue(repository.state.value.favoritesInitialized)
        assertEquals(Language.ZH, repository.state.value.privateLanguage)
    }
}
