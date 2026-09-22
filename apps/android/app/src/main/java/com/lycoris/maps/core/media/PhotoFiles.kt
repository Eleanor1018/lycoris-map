package com.lycoris.maps.core.media

import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.security.MessageDigest

/** App-private durable bytes. Construct with Context.noBackupFilesDir/"contribution-photos". */
class PhotoFiles(val directory: File) {
    init { if (!directory.isDirectory && !directory.mkdirs()) throw PhotoFailure.Storage() }

    fun file(photo: EncodedPhoto): File {
        if (!photo.isValid()) throw PhotoFailure.Missing()
        val candidate = File(directory, photo.filename)
        if (candidate.canonicalFile.parentFile != directory.canonicalFile) throw PhotoFailure.Missing()
        return candidate
    }

    fun verify(photo: EncodedPhoto): File {
        val candidate = file(photo)
        try {
            if (!candidate.isFile || candidate.length() != photo.byteCount.toLong() || hash(candidate) != photo.sha256) throw PhotoFailure.Missing()
            return candidate
        } catch (_: IOException) { throw PhotoFailure.Missing() }
    }

    fun delete(photo: EncodedPhoto) { runCatching { file(photo).delete() } }

    companion object {
        fun hash(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            FileInputStream(file).use { stream ->
                val buffer = ByteArray(32 * 1024)
                while (true) {
                    val read = stream.read(buffer)
                    if (read < 0) break
                    if (read > 0) digest.update(buffer, 0, read)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
        }
    }
}
