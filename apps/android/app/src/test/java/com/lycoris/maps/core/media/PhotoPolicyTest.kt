package com.lycoris.maps.core.media

import java.io.File
import java.nio.file.Files
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test

class PhotoPolicyTest {
    @Test fun sampleAndOutputBoundMemoryPreserveAspectAndDoNotUpscale() {
        assertEquals(2048 to 1536, PhotoPolicy.outputSize(8000, 6000))
        assertEquals(2, PhotoPolicy.sampleSize(8000, 6000))
        assertEquals(320 to 240, PhotoPolicy.outputSize(320, 240))
        assertEquals(1 to 2048, PhotoPolicy.outputSize(1, 50000))
        for ((w, h) in listOf(0 to 100, -1 to 1, 50001 to 1, 20000 to 20000)) {
            try { PhotoPolicy.outputSize(w, h); fail("Invalid dimensions accepted") } catch (_: IllegalArgumentException) { }
        }
    }
    @Test fun durablePhotoDetectsMutationMissingFileAndUnsafeMetadata() {
        val directory = Files.createTempDirectory("photo-policy-test").toFile()
        try {
            val files = PhotoFiles(directory)
            val id = UUID.randomUUID().toString()
            val file = File(directory, "$id.jpg").apply { writeBytes(byteArrayOf(1, 2, 3)) }
            val photo = EncodedPhoto(id, file.name, 3, PhotoFiles.hash(file), 30, 20)
            assertEquals(file, files.verify(photo))
            assertFalse(photo.copy(filename = "../other.jpg").isValid())
            assertFalse(photo.copy(mimeType = "image/heic").isValid())
            assertFalse(photo.copy(width = 10001).isValid())
            assertFalse(photo.copy(width = 10000, height = 10000).isValid())
            file.writeBytes(byteArrayOf(3, 2, 1))
            try { files.verify(photo); fail("Hash mismatch accepted") } catch (_: PhotoFailure.Missing) { }
            file.delete()
            try { files.verify(photo); fail("Missing image accepted") } catch (_: PhotoFailure.Missing) { }
        } finally { directory.deleteRecursively() }
    }
}
