package com.lycoris.maps.core.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** Copies Photo Picker content while its grant is live; URI permissions are not needed on resume. */
class PhotoImporter(context: Context, val files: PhotoFiles = PhotoFiles(File(context.noBackupFilesDir, "contribution-photos"))) {
    private val resolver = context.applicationContext.contentResolver

    suspend fun importPhoto(uri: Uri): EncodedPhoto {
        if (uri.scheme != "content") throw PhotoFailure.Unsupported()
        return importStream { resolver.openInputStream(uri) ?: throw PhotoFailure.Unsupported() }
    }

    /** The same bounded decoder pipeline; separated from URI grant acquisition for local codec verification. */
    internal suspend fun importStream(open: () -> InputStream): EncodedPhoto {
        var deliveredFile: File? = null
        try {
            val result = withContext(Dispatchers.IO) { encode(open) { deliveredFile = it } }
            deliveredFile = null
            return result
        } finally {
            // Covers prompt cancellation while returning from Dispatchers.IO, before the caller owns the file.
            deliveredFile?.delete()
        }
    }

    private suspend fun encode(open: () -> InputStream, ready: (File) -> Unit): EncodedPhoto {
        val source = try { File.createTempFile("source-", ".tmp", files.directory) } catch (_: IOException) { throw PhotoFailure.Storage() }
        val encoded = try { File.createTempFile("encoded-", ".tmp", files.directory) } catch (_: IOException) {
            source.delete()
            throw PhotoFailure.Storage()
        }
        var bitmap: Bitmap? = null
        var finalFile: File? = null
        try {
            open().use { input ->
                FileOutputStream(source).use { output ->
                    val buffer = ByteArray(32 * 1024)
                    var copied = 0L
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (count == 0) continue
                        copied += count
                        if (copied > PhotoPolicy.MAX_SOURCE_BYTES) throw PhotoFailure.TooLarge()
                        output.write(buffer, 0, count)
                    }
                }
            }
            currentCoroutineContext().ensureActive()
            val decoded = decode(source)
            bitmap = decoded
            // Draw pixels into a fresh sRGB RGB-backed bitmap: no original EXIF/GPS metadata survives.
            val size = PhotoPolicy.outputSize(decoded.width, decoded.height)
            val clean = Bitmap.createBitmap(size.first, size.second, Bitmap.Config.ARGB_8888)
            bitmap = clean
            try {
                Canvas(clean).apply {
                    drawColor(Color.WHITE)
                    drawBitmap(decoded, null, android.graphics.Rect(0, 0, clean.width, clean.height), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
                }
            } finally { decoded.recycle() }
            var accepted = false
            for (quality in listOf(88, 78, 68, 58)) {
                currentCoroutineContext().ensureActive()
                FileOutputStream(encoded).use { output ->
                    if (!clean.compress(Bitmap.CompressFormat.JPEG, quality, output)) throw PhotoFailure.Unsupported()
                    output.fd.sync()
                }
                if (encoded.length() in 1..PhotoPolicy.MAX_UPLOAD_BYTES.toLong()) { accepted = true; break }
            }
            if (!accepted) throw PhotoFailure.TooLarge()
            val id = UUID.randomUUID().toString()
            val target = File(files.directory, "$id.jpg")
            currentCoroutineContext().ensureActive()
            if (!encoded.renameTo(target)) throw PhotoFailure.Storage()
            finalFile = target
            val photo = EncodedPhoto(id, target.name, target.length().toInt(), PhotoFiles.hash(target), clean.width, clean.height)
            if (!photo.isValid()) throw PhotoFailure.Storage()
            currentCoroutineContext().ensureActive()
            ready(target)
            finalFile = null
            return photo
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (known: PhotoFailure) {
            throw known
        } catch (_: SecurityException) {
            throw PhotoFailure.Unsupported()
        } catch (_: OutOfMemoryError) {
            throw PhotoFailure.TooLarge()
        } catch (_: IllegalArgumentException) {
            throw PhotoFailure.Unsupported()
        } catch (_: IOException) {
            throw PhotoFailure.Storage()
        } finally {
            bitmap?.recycle()
            source.delete()
            encoded.delete()
            finalFile?.delete()
        }
    }

    private fun decode(source: File): Bitmap {
        if (Build.VERSION.SDK_INT >= 28) {
            // ImageDecoder applies EXIF orientation, including mirrored orientations.
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(source)) { decoder, info, _ ->
                val size = PhotoPolicy.outputSize(info.size.width, info.size.height)
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.setTargetSize(size.first, size.second)
                decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.path, bounds)
        val sample = PhotoPolicy.sampleSize(bounds.outWidth, bounds.outHeight)
        val raw = BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }) ?: throw PhotoFailure.Unsupported()
        try {
            val orientation = ExifInterface(source).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            val matrix = Matrix().apply {
                when (orientation) {
                    ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
                    ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
                    ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
                    ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f, 1f) }
                    ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
                    ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(-90f); postScale(-1f, 1f) }
                    ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(-90f)
                }
            }
            val oriented = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, matrix, true)
            if (oriented !== raw) raw.recycle()
            return oriented
        } catch (failure: Throwable) {
            raw.recycle()
            throw failure
        }
    }
}
