package com.lycoris.maps.feature.contributions

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.exifinterface.media.ExifInterface
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.lycoris.maps.core.data.SessionIdentity
import com.lycoris.maps.core.data.AccountRepository
import com.lycoris.maps.core.model.User
import com.lycoris.maps.core.network.AuthEnvelope
import com.lycoris.maps.core.network.LycorisApi
import com.lycoris.maps.core.network.SessionCookieJar
import com.lycoris.maps.core.network.MemoryCookiePersistence
import com.lycoris.maps.core.media.EncodedPhoto
import java.lang.reflect.Proxy
import okhttp3.HttpUrl.Companion.toHttpUrl
import retrofit2.Response
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.CancellationException
import com.lycoris.maps.core.media.PhotoFailure
import java.io.InputStream
import kotlinx.coroutines.withTimeout
import com.lycoris.maps.core.data.drafts.ContributionDatabase
import com.lycoris.maps.core.data.drafts.DraftLocks
import com.lycoris.maps.core.data.drafts.RoomDraftStore
import com.lycoris.maps.core.media.PhotoFiles
import com.lycoris.maps.core.media.PhotoImporter
import com.lycoris.maps.core.media.PhotoPolicy
import com.lycoris.maps.core.model.Marker
import com.lycoris.maps.core.network.CreateMarkerRequest
import com.lycoris.maps.core.network.CreateUploadRequest
import com.lycoris.maps.core.network.LycorisJson
import com.lycoris.maps.core.network.UploadReceipt
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Entirely isolated local data and synthetic transports. Never calls the application's production API. */
@RunWith(AndroidJUnit4::class)
class ContributionPersistenceTest {
    private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val identity = SessionIdentity("https://offline-fixture.invalid/", "synthetic-owner", 1)
    private fun fixture() = File(context.noBackupFilesDir, "contribution-instrumentation-${UUID.randomUUID()}").apply { mkdirs() }
    private fun open(directory: File) = Room.databaseBuilder(context, ContributionDatabase::class.java, File(directory, "drafts.db").absolutePath).build()
    private fun draft() = ContributionDraft(UUID.randomUUID().toString(), identity.publicId, identity.origin, 31.2, 121.5, ContributionFields(title = "Synthetic room fixture"))

    @Test fun roomReopenRetainsOwnerExactBodyReceiptAndRejectsStaleWrites() = runBlocking {
        val directory = fixture()
        var database = open(directory)
        try {
            val d = draft()
            val frozen = d.copy(phase = DraftPhase.CREATING, frozenRequest = d.frozenBody())
            val store = RoomDraftStore(database.drafts())
            store.insert(frozen)
            val updated = store.update(frozen, frozen.copy(attempts = 2, problem = DraftProblem.NETWORK))
            val photoId = UUID.randomUUID().toString()
            val photo = EncodedPhoto(photoId, "$photoId.jpg", 262145, "a".repeat(64), 320, 200)
            val receipt = UploadReceipt(UUID.randomUUID().toString(), 7002, photo.byteCount, 262144, 262144, "UPLOADING")
            val uploading = draft().copy(phase = DraftPhase.UPLOADING, markerId = 7002, photo = photo, upload = receipt)
            store.insert(uploading)
            try { store.update(frozen, frozen.copy(attempts = 3)); fail("Stale revision accepted") } catch (_: DraftStorageFailure) { }
            database.close()
            database = open(directory)
            val reopened = RoomDraftStore(database.drafts())
            val durable = reopened.get(d.id)!!
            assertEquals(updated, durable)
            assertEquals(frozen.frozenRequest, durable.frozenRequest)
            assertTrue(reopened.list(identity.origin, "another-owner").isEmpty())
            assertTrue(reopened.list("https://another-origin.invalid/", identity.publicId).isEmpty())
            assertEquals(2, reopened.list(identity.origin, identity.publicId).size)
            assertEquals(receipt, reopened.get(uploading.id)!!.upload)
            assertEquals(photo, reopened.get(uploading.id)!!.photo)
        } finally { database.close(); directory.deleteRecursively() }
    }

    @Test fun customWorkerFactoryResumesReopenedFrozenCreateOnce() = runBlocking {
        val directory = fixture()
        var database = open(directory)
        try {
            val d = draft()
            val frozen = d.copy(phase = DraftPhase.CREATING, frozenRequest = d.frozenBody())
            RoomDraftStore(database.drafts()).insert(frozen)
            database.close()
            database = open(directory)
            val store = RoomDraftStore(database.drafts())
            val transport = SyntheticTransport(identity)
            val engine = ContributionEngine(store, DraftLocks(), transport, PhotoFiles(File(directory, "photos")))
            fun worker() = TestListenableWorkerBuilder<ContributionWorker>(context)
                .setInputData(workDataOf(ContributionWorker.DRAFT_ID to d.id))
                .setWorkerFactory(ContributionWorkerFactory { engine }).build()
            assertEquals(ListenableWorker.Result.success(), worker().doWork())
            assertEquals(frozen.frozenRequest, transport.bodies.single())
            assertEquals(DraftPhase.COMPLETE, store.get(d.id)!!.phase)
            assertEquals(7001L, store.get(d.id)!!.markerId)
            assertEquals(ListenableWorker.Result.success(), worker().doWork())
            assertEquals(1, transport.bodies.size)
        } finally { database.close(); directory.deleteRecursively() }
    }

    @Test fun reopenedAmbiguousEditBecomesUncertainWithoutAnyMutation() = runBlocking {
        val directory = fixture()
        var database = open(directory)
        try {
            val original = Marker(7001, 31.2, 121.5, "baby_room", "Original")
            val d = draft().copy(original = original, markerId = original.id, fields = ContributionFields.fromMarker(original).copy(title = "Changed"))
            RoomDraftStore(database.drafts()).insert(d.copy(phase = DraftPhase.EDITING, frozenRequest = d.frozenBody()))
            database.close()
            database = open(directory)
            val store = RoomDraftStore(database.drafts())
            val transport = SyntheticTransport(identity)
            val engine = ContributionEngine(store, DraftLocks(), transport, PhotoFiles(File(directory, "photos")))
            val worker = TestListenableWorkerBuilder<ContributionWorker>(context)
                .setInputData(workDataOf(ContributionWorker.DRAFT_ID to d.id))
                .setWorkerFactory(ContributionWorkerFactory { engine }).build()
            assertEquals(ListenableWorker.Result.success(), worker.doWork())
            assertEquals(DraftPhase.UNCERTAIN_EDIT, store.get(d.id)!!.phase)
            assertTrue(transport.bodies.isEmpty())
            assertEquals(0, transport.edits)
        } finally { database.close(); directory.deleteRecursively() }
    }

    @Test fun importedPhotoAppliesExifRotationAndRemovesGpsAndIdentityMetadata() = runBlocking {
        val directory = fixture()
        try {
            val input = makeImage(File(directory, "source.jpg"), 80, 40)
            ExifInterface(input).apply {
                setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString())
                setAttribute(ExifInterface.TAG_MAKE, "Synthetic private camera")
                setAttribute(ExifInterface.TAG_USER_COMMENT, "Synthetic private comment")
                setLatLong(31.2, 121.5)
                saveAttributes()
            }
            val importer = PhotoImporter(context, PhotoFiles(File(directory, "sanitized")))
            val photo = importer.importStream { input.inputStream() }
            assertEquals(40, photo.width)
            assertEquals(80, photo.height)
            assertTrue(photo.byteCount in 1..PhotoPolicy.MAX_UPLOAD_BYTES)
            val output = importer.files.verify(photo)
            val exif = ExifInterface(output)
            assertNull(exif.latLong)
            assertNull(exif.getAttribute(ExifInterface.TAG_MAKE))
            assertNull(exif.getAttribute(ExifInterface.TAG_USER_COMMENT))
            assertTrue(exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) in setOf(0, 1))
            val bitmap = BitmapFactory.decodeFile(output.path)
            try {
                val top = bitmap.getPixel(20, 10)
                val bottom = bitmap.getPixel(20, 70)
                assertTrue(Color.red(top) > Color.blue(top) + 100)
                assertTrue(Color.blue(bottom) > Color.red(bottom) + 100)
            } finally { bitmap.recycle() }
            assertEquals(listOf(photo.filename), importer.files.directory.list()?.toList())
        } finally { directory.deleteRecursively() }
    }

    @Test fun importedMirroredPhotoPreservesVisibleOrientationAndLargeImagesAreSampled() = runBlocking {
        val directory = fixture()
        try {
            val input = makeImage(File(directory, "source.jpg"), 3000, 1000)
            ExifInterface(input).apply {
                setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_FLIP_HORIZONTAL.toString())
                saveAttributes()
            }
            val importer = PhotoImporter(context, PhotoFiles(File(directory, "sanitized")))
            val photo = importer.importStream { input.inputStream() }
            assertEquals(2048, photo.width)
            assertEquals(683, photo.height)
            assertTrue(photo.byteCount in 1..PhotoPolicy.MAX_UPLOAD_BYTES)
            assertEquals("image/jpeg", photo.mimeType)
            val output = BitmapFactory.decodeFile(importer.files.verify(photo).path)
            try {
                val left = output.getPixel(10, 10)
                val right = output.getPixel(output.width - 10, 10)
                assertTrue(Color.blue(left) > Color.red(left) + 100)
                assertTrue(Color.red(right) > Color.blue(right) + 100)
            } finally { output.recycle() }
        } finally { directory.deleteRecursively() }
    }

    @Test fun fieldQueueFlushPersistsLastCharacterBeforeSubmit() = runBlocking {
        val directory = fixture()
        val database = open(directory)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            val accounts = syntheticAccounts(scope)
            accounts.login("synthetic", "synthetic-password")
            val store = RoomDraftStore(database.drafts())
            val locks = DraftLocks()
            val importer = PhotoImporter(context, PhotoFiles(File(directory, "photos")))
            val transport = SyntheticTransport(accounts.identity()!!)
            val engine = ContributionEngine(store, locks, transport, importer.files)
            val scheduler = CapturingScheduler()
            val coordinator = ContributionCoordinator(accounts, store, locks, importer, engine, scheduler, scope)
            val id = coordinator.createDraft(31.2, 121.5, "en")
            repeat(50) { coordinator.enqueueFields(id, ContributionFields(title = "Last character $it")) }
            withTimeout(10_000) { coordinator.submit(id) }
            val frozen = store.get(id)!!
            assertEquals("Last character 49", frozen.fields.title)
            assertEquals("Last character 49", LycorisJson.decodeFromString<CreateMarkerRequest>(frozen.frozenRequest!!).title)
            assertEquals(DraftPhase.CREATING, frozen.phase)
            assertTrue(scheduler.enqueued.any { it.id == id })
        } finally { scope.coroutineContext[Job]!!.cancelAndJoin(); database.close(); directory.deleteRecursively() }
    }

    @Test fun queuedFieldEditCannotCrossSameOwnerReauthenticationEpoch() = runBlocking {
        val directory = fixture()
        val database = open(directory)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            val accounts = syntheticAccounts(scope)
            accounts.login("synthetic", "synthetic-password")
            val store = RoomDraftStore(database.drafts())
            val locks = DraftLocks()
            val importer = PhotoImporter(context, PhotoFiles(File(directory, "photos")))
            val engine = ContributionEngine(store, locks, SyntheticTransport(accounts.identity()!!), importer.files)
            val coordinator = ContributionCoordinator(accounts, store, locks, importer, engine, CapturingScheduler(), scope)
            val id = coordinator.createDraft(31.2, 121.5, "en")
            val mutex = locks.forDraft(id)
            mutex.lock()
            try {
                coordinator.enqueueFields(id, ContributionFields(title = "Must not cross account epoch"))
                accounts.clearLocalSession()
                accounts.login("synthetic", "synthetic-password")
            } finally { mutex.unlock() }
            withTimeout(10_000) { coordinator.flushFields(id) }
            assertEquals("", store.get(id)!!.fields.title)
        } finally { scope.coroutineContext[Job]!!.cancelAndJoin(); database.close(); directory.deleteRecursively() }
    }

    @Test fun photoOnlyEditSchedulesUploadWithoutUnchangedPatch() = runBlocking {
        val directory = fixture()
        val database = open(directory)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            val accounts = syntheticAccounts(scope)
            accounts.login("synthetic", "synthetic-password")
            val store = RoomDraftStore(database.drafts())
            val locks = DraftLocks()
            val importer = PhotoImporter(context, PhotoFiles(File(directory, "photos")))
            val transport = SyntheticTransport(accounts.identity()!!)
            val engine = ContributionEngine(store, locks, transport, importer.files)
            val scheduler = CapturingScheduler()
            val coordinator = ContributionCoordinator(accounts, store, locks, importer, engine, scheduler, scope)
            val marker = Marker(7001, 31.2, 121.5, "baby_room", "Original")
            val id = coordinator.createDraft(marker.lat, marker.lng, "en", marker)
            val source = makeImage(File(directory, "image.jpg"), 80, 40)
            val photo = importer.importStream { source.inputStream() }
            val before = store.get(id)!!
            store.update(before, before.copy(photo = photo))
            withTimeout(10_000) { coordinator.submit(id) }
            assertEquals(DraftPhase.UPLOADING, store.get(id)!!.phase)
            assertEquals(0, transport.edits)
            assertTrue(transport.bodies.isEmpty())
            assertTrue(scheduler.enqueued.any { it.id == id })
        } finally { scope.coroutineContext[Job]!!.cancelAndJoin(); database.close(); directory.deleteRecursively() }
    }

    @Test fun cancelledAndOversizeSourcesLeaveNoTemporaryImages() = runBlocking {
        val directory = fixture()
        try {
            val importer = PhotoImporter(context, PhotoFiles(File(directory, "photos")))
            try {
                importer.importStream {
                    object : InputStream() {
                        override fun read(): Int = throw CancellationException("Synthetic cancellation")
                        override fun read(bytes: ByteArray, offset: Int, length: Int): Int = throw CancellationException("Synthetic cancellation")
                    }
                }
                fail("Expected cancellation")
            } catch (_: CancellationException) { }
            assertTrue(importer.files.directory.listFiles()!!.isEmpty())
            try {
                importer.importStream {
                    object : InputStream() {
                        override fun read(): Int = 0
                        override fun read(bytes: ByteArray, offset: Int, length: Int): Int { bytes.fill(0, offset, offset + length); return length }
                    }
                }
                fail("Unbounded source was accepted")
            } catch (_: PhotoFailure.TooLarge) { }
            assertTrue(importer.files.directory.listFiles()!!.isEmpty())
        } finally { directory.deleteRecursively() }
    }

    private fun syntheticAccounts(scope: CoroutineScope): AccountRepository {
        val api = Proxy.newProxyInstance(LycorisApi::class.java.classLoader, arrayOf(LycorisApi::class.java)) { _, method, _ ->
            check(method.name == "login") { "Unexpected API method ${method.name}; tests must never use a real network" }
            Response.success(AuthEnvelope(code = 0, data = User(publicId = identity.publicId)))
        } as LycorisApi
        return AccountRepository(SessionCookieJar(identity.origin.toHttpUrl(), MemoryCookiePersistence()), { api }, scope)
    }

    private class CapturingScheduler : ContributionScheduler {
        val enqueued = java.util.Collections.synchronizedList(mutableListOf<ContributionDraft>())
        override suspend fun enqueue(draft: ContributionDraft, replace: Boolean) { enqueued += draft }
        override suspend fun cancel(id: String) { }
        override suspend fun cancelOwner(origin: String, owner: String) { }
    }

    private fun makeImage(file: File, width: Int, height: Int): File {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        try {
            Canvas(bitmap).apply {
                drawColor(Color.BLUE)
                drawRect(0f, 0f, width / 2f, height.toFloat(), Paint().apply { color = Color.RED })
            }
            FileOutputStream(file).use { assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 98, it)) }
            return file
        } finally { bitmap.recycle() }
    }

    private class SyntheticTransport(private val current: SessionIdentity) : ContributionTransport {
        val bodies = mutableListOf<String>()
        var edits = 0
        override fun identity() = current
        override suspend fun restoreSession() { }
        override suspend fun create(identity: SessionIdentity, frozenJson: String, language: String): Marker {
            assertEquals(current, identity)
            bodies += frozenJson
            val request = LycorisJson.decodeFromString<CreateMarkerRequest>(frozenJson)
            return Marker(7001, request.lat, request.lng, request.category, request.title, userPublicId = identity.publicId, clientRequestId = request.clientRequestId)
        }
        override suspend fun edit(identity: SessionIdentity, markerId: Long, frozenJson: String, language: String): Marker { edits++; error("PATCH must not replay") }
        override suspend fun beginUpload(identity: SessionIdentity, markerId: Long, request: CreateUploadRequest): UploadReceipt = error("Unexpected upload")
        override suspend fun uploadStatus(identity: SessionIdentity, markerId: Long, uploadId: String): UploadReceipt = error("Unexpected upload")
        override suspend fun chunk(identity: SessionIdentity, markerId: Long, uploadId: String, offset: Int, bytes: ByteArray): UploadReceipt = error("Unexpected upload")
        override suspend fun complete(identity: SessionIdentity, markerId: Long, uploadId: String): UploadReceipt = error("Unexpected upload")
    }
}
