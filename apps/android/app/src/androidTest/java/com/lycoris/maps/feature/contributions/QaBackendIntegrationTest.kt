package com.lycoris.maps.feature.contributions

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.os.Bundle
import android.security.NetworkSecurityPolicy
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.lycoris.maps.BuildConfig
import com.lycoris.maps.core.data.AccountRepository
import com.lycoris.maps.core.data.SessionIdentity
import com.lycoris.maps.core.media.PhotoFiles
import com.lycoris.maps.core.media.PhotoImporter
import com.lycoris.maps.core.media.PhotoPolicy
import com.lycoris.maps.core.model.Language
import com.lycoris.maps.core.network.ApiClients
import com.lycoris.maps.core.network.CreateUploadRequest
import com.lycoris.maps.core.network.EncryptedCookiePersistence
import com.lycoris.maps.core.network.LycorisJson
import com.lycoris.maps.core.network.QA_ENVIRONMENT
import com.lycoris.maps.core.network.QaManifest
import com.lycoris.maps.core.network.SessionCookieJar
import com.lycoris.maps.core.network.requireBody
import com.lycoris.maps.core.network.requireSuccess
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Opt-in device -> guarded gateway -> actual isolated Rust/Postgres integration; never production. */
@RunWith(AndroidJUnit4::class)
class QaBackendIntegrationTest {
    companion object {
        private const val ORIGIN = "http://10.0.2.2:18187/"
        private const val USERNAME_ARGUMENT = "lycorisQaUsername"
        private const val PASSWORD_ARGUMENT = "lycorisQaPassword"
    }

    @Test fun realRustSessionFavoritesIdempotentCreationAndResumableImage() = runBlocking {
        val arguments = InstrumentationRegistry.getArguments()
        val username = arguments.getString(USERNAME_ARGUMENT)
        val password = arguments.getString(PASSWORD_ARGUMENT)
        assumeTrue("Synthetic QA credentials were not supplied; live backend test is opt-in", !username.isNullOrBlank() && !password.isNullOrBlank())
        // These are assertions, not skips: supplying credentials to any other build/origin must fail closed.
        assertTrue("Live writes require TEST_ENVIRONMENT", BuildConfig.TEST_ENVIRONMENT)
        assertEquals("Live writes require the fixed emulator QA gateway", ORIGIN, BuildConfig.API_BASE_URL)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertTrue("Only the isolated QA application may run live write tests", context.packageName.endsWith(".qa"))
        assertTrue("Expected a generated synthetic QA account", username!!.matches(Regex("android_qa_(?:fixture|alice|bob)_[a-f0-9]{8}")))
        assertTrue(NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted("10.0.2.2"))
        assertFalse(NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted("api.lycoris-map.com"))

        val directory = File(context.noBackupFilesDir, "live-qa-${UUID.randomUUID()}").apply { check(mkdirs()) }
        val isolatedContext = object : ContextWrapper(context) { override fun getNoBackupFilesDir(): File = directory }
        // Isolate the Keystore alias as well as the file; never clear the app UI's session during teardown.
        val persistenceNamespace = "$ORIGIN#instrumentation-${UUID.randomUUID()}"
        var persistence = EncryptedCookiePersistence(isolatedContext, persistenceNamespace)
        var scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        var account: AccountRepository? = null
        var originalFavorite: Boolean? = null
        var sentinelId: Long? = null
        try {
            var cookies = SessionCookieJar(ORIGIN.toHttpUrl(), persistence)
            var clients = clients(cookies)
            val manifest = verifiedManifest(clients)
            val favoriteMarkerId = manifest.sentinel.markerId
            sentinelId = favoriteMarkerId
            val sentinel = clients.publicApi.marker(favoriteMarkerId, "en").requireBody()
            assertTrue("QA sentinel content mismatch", sentinel.title == manifest.sentinel.title &&
                sentinel.description == manifest.sentinel.description && sentinel.userPublicId == manifest.sentinel.ownerPublicId &&
                sentinel.clientRequestId == manifest.sentinel.clientRequestId && sentinel.publiclyVisible)
            // ApiClients(testEnvironment=true) independently repeats preflight before EVERY mutation, including login.
            var repository = AccountRepository(clients, scope)
            account = repository
            val signedIn = repository.login(username, password!!)
            assertTrue("QA login returned another account", signedIn.username == username)
            assertTrue("QA session cookie was not retained", cookies.hasCookies())
            assertTrue("Encrypted cookie file was not written", directory.listFiles().orEmpty().any { it.extension == "bin" && it.length() > 29 })

            // Recreate persistence, cookie jar and repository; no login is sent for the restored session.
            scope.coroutineContext[Job]!!.cancelAndJoin()
            scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            persistence = EncryptedCookiePersistence(isolatedContext, persistenceNamespace)
            cookies = SessionCookieJar(ORIGIN.toHttpUrl(), persistence)
            clients = clients(cookies)
            repository = AccountRepository(clients, scope)
            account = repository
            repository.restore()
            assertTrue("Fresh repository could not restore the encrypted session", repository.state.value.user?.publicId == signedIn.publicId)
            val identity = repository.identity() ?: error("Synthetic session was not restored")

            repository.refreshFavorites(Language.EN)
            originalFavorite = favoriteMarkerId in repository.state.value.favoriteIds
            if (originalFavorite == true) repository.toggleFavorite(favoriteMarkerId, Language.EN)
            assertFalse(repository.state.value.favoriteIds.contains(favoriteMarkerId))
            repository.toggleFavorite(favoriteMarkerId, Language.EN)
            assertTrue("Favorite add did not persist", repository.state.value.favoriteIds.contains(favoriteMarkerId))
            repository.refreshFavorites(Language.EN)
            assertTrue("Favorite refresh lost the added point", repository.state.value.favoriteIds.contains(favoriteMarkerId))
            repository.toggleFavorite(favoriteMarkerId, Language.EN)
            repository.refreshFavorites(Language.EN)
            assertFalse("Favorite removal did not persist", repository.state.value.favoriteIds.contains(favoriteMarkerId))

            val requestId = UUID.randomUUID().toString()
            val contribution = ContributionDraft(
                id = requestId, owner = identity.publicId, origin = identity.origin,
                latitude = 31.2305, longitude = 121.4738,
                fields = ContributionFields(
                    title = "Android QA integration $requestId", category = "baby_room",
                    description = "Synthetic Android QA integration only. This is not a production location.", language = "en",
                ),
            )
            val frozenJson = contribution.frozenBody()
            val transport = AccountContributionTransport(repository)
            val created = transport.create(identity, frozenJson, "en")
            val replay = transport.create(identity, frozenJson, "en")
            assertTrue(created.id > 0 && created.clientRequestId == requestId && created.userPublicId == identity.publicId)
            assertEquals("Idempotent create returned another marker", created.id, replay.id)
            assertEquals("PENDING", created.reviewStatus)
            val createdList = repository.withAuthenticatedRead(expectedIdentity = identity) { api, _ -> api.createdPlaces("en").requireBody() }
            assertEquals("The same create key produced multiple markers", 1, createdList.count { it.clientRequestId == requestId })

            val importer = PhotoImporter(isolatedContext, PhotoFiles(File(directory, "photos")))
            val original = syntheticImage(File(directory, "synthetic-source.jpg"))
            val photo = importer.importStream { original.inputStream() }
            assertTrue("Fixture must exercise multiple actual chunks", photo.byteCount > PhotoPolicy.UPLOAD_CHUNK_BYTES)
            val bytes = importer.files.verify(photo).readBytes()
            val uploadDraft = contribution.copy(phase = DraftPhase.UPLOADING, markerId = created.id, photo = photo, frozenRequest = frozenJson)
            val start = CreateUploadRequest(photo.id, photo.byteCount, photo.sha256)
            var receipt = transport.beginUpload(identity, created.id, start)
            assertTrue(UploadReceiptPolicy.valid(receipt, uploadDraft))
            assertEquals(0, receipt.receivedBytes)
            val duplicateStart = transport.beginUpload(identity, created.id, start)
            assertEquals("Idempotent upload start returned another session", receipt.uploadId, duplicateStart.uploadId)
            assertTrue(UploadReceiptPolicy.valid(duplicateStart, uploadDraft, receipt))
            var first = true
            while (receipt.receivedBytes < photo.byteCount) {
                val offset = receipt.receivedBytes
                val chunk = bytes.copyOfRange(offset, minOf(offset + PhotoPolicy.UPLOAD_CHUNK_BYTES, bytes.size))
                val next = transport.chunk(identity, created.id, receipt.uploadId, offset, chunk)
                assertTrue(UploadReceiptPolicy.valid(next, uploadDraft, receipt))
                assertEquals(offset + chunk.size, next.receivedBytes)
                receipt = next
                if (first) {
                    first = false
                    val duplicateChunk = transport.chunk(identity, created.id, receipt.uploadId, offset, chunk)
                    assertEquals("Identical duplicate chunk advanced twice", receipt.receivedBytes, duplicateChunk.receivedBytes)
                    val reconciled = transport.uploadStatus(identity, created.id, receipt.uploadId)
                    assertTrue(UploadReceiptPolicy.valid(reconciled, uploadDraft, receipt))
                    assertEquals(receipt.receivedBytes, reconciled.receivedBytes)
                    receipt = reconciled
                }
            }
            val complete = transport.complete(identity, created.id, receipt.uploadId)
            assertTrue(UploadReceiptPolicy.valid(complete, uploadDraft, receipt))
            assertEquals("COMPLETED", complete.status)
            val repeatComplete = transport.complete(identity, created.id, receipt.uploadId)
            assertEquals("Repeated completion changed the upload receipt", complete, repeatComplete)
            assertEquals(complete, transport.uploadStatus(identity, created.id, receipt.uploadId))
            assertEquals(complete, transport.beginUpload(identity, created.id, start))

            // Public protocol exposes no proposal count. Root verifies these opaque IDs against the isolated
            // PostgreSQL oracle; a repeated COMPLETED receipt alone is not proof of one database proposal.
            InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply {
                putLong("lycorisQaMarkerId", created.id)
                putString("lycorisQaUploadId", complete.uploadId)
                putString("lycorisQaCreationRequestId", requestId)
                putString("lycorisQaPhotoRequestId", photo.id)
                putString("lycorisQaOwnerPublicId", identity.publicId)
            })
        } finally {
            withContext(NonCancellable + Dispatchers.IO) {
                try {
                    val current = account
                    val id = sentinelId
                    val wasFavorite = originalFavorite
                    if (current != null && id != null && wasFavorite != null) {
                        val identity = current.identity()
                        if (identity != null) restoreFavorite(current, identity, id, wasFavorite)
                    }
                    if (current?.identity() != null) current.logout()
                } finally {
                    scope.coroutineContext[Job]!!.cancelAndJoin()
                    persistence.clear()
                    directory.deleteRecursively()
                }
            }
        }
    }

    private fun clients(cookies: SessionCookieJar) = ApiClients(
        ORIGIN, cookies, "LycorisAndroid/SyntheticQAInstrumentation", testEnvironment = true,
    )

    private fun verifiedManifest(clients: ApiClients): QaManifest {
        val request = Request.Builder().url("${ORIGIN}__lycoris_qa__/manifest").get().build()
        return clients.publicClient.newCall(request).execute().use { response ->
            assertEquals("QA manifest unavailable", 200, response.code)
            assertTrue("Missing synthetic environment header", response.header("X-Lycoris-Test-Environment") == QA_ENVIRONMENT)
            val source = response.body.source()
            source.request(16_385)
            assertTrue("QA manifest is oversized", source.buffer.size <= 16_384)
            LycorisJson.decodeFromString<QaManifest>(source.readUtf8()).also { it.verifiedNonce() }
        }
    }

    private suspend fun restoreFavorite(repository: AccountRepository, identity: SessionIdentity, id: Long, expected: Boolean) {
        val current = repository.withAuthenticatedRead(expectedIdentity = identity) { api, _ -> api.favoriteIds().requireBody() }
        if ((id in current) != expected) repository.withAuthenticatedMutation(expectedIdentity = identity) { api, _ ->
            (if (expected) api.addFavorite(id) else api.removeFavorite(id)).requireSuccess()
        }
        val restored = repository.withAuthenticatedRead(expectedIdentity = identity) { api, _ -> api.favoriteIds().requireBody() }
        assertTrue("Synthetic account favorite baseline was not restored", (id in restored) == expected)
    }

    private fun syntheticImage(file: File): File {
        val side = 1024
        val random = kotlin.random.Random(17863)
        val pixels = IntArray(side * side) { 0xff000000.toInt() or random.nextInt(0x1000000) }
        val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
        try {
            bitmap.setPixels(pixels, 0, side, 0, 0, side, side)
            FileOutputStream(file).use { check(bitmap.compress(Bitmap.CompressFormat.JPEG, 98, it)) }
            return file
        } finally { bitmap.recycle() }
    }
}
