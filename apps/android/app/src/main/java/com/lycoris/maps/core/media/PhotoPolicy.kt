package com.lycoris.maps.core.media

import kotlinx.serialization.Serializable
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt

/** Existing Rust resumable/avatar limits; output is intentionally smaller for mobile uploads. */
object PhotoPolicy {
    const val MAX_UPLOAD_BYTES = 5 * 1024 * 1024
    const val UPLOAD_CHUNK_BYTES = 256 * 1024
    const val SERVER_MAX_EDGE = 10_000
    const val SERVER_MAX_PIXELS = 25_000_000L
    const val OUTPUT_MAX_EDGE = 2048
    const val MAX_SOURCE_BYTES = 32L * 1024 * 1024
    const val MAX_SOURCE_EDGE = 50_000
    const val MAX_SOURCE_PIXELS = 200_000_000L

    fun outputSize(width: Int, height: Int): Pair<Int, Int> {
        require(width in 1..MAX_SOURCE_EDGE && height in 1..MAX_SOURCE_EDGE && width.toLong() * height <= MAX_SOURCE_PIXELS)
        val scale = minOf(1.0, OUTPUT_MAX_EDGE.toDouble() / max(width, height))
        return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
    }

    fun sampleSize(width: Int, height: Int): Int {
        outputSize(width, height) // Validate before any decoder allocation.
        var sample = 1
        while (max(width / (sample * 2), height / (sample * 2)) >= OUTPUT_MAX_EDGE) sample *= 2
        return sample
    }
}

@Serializable
data class EncodedPhoto(
    val id: String,
    val filename: String,
    val byteCount: Int,
    val sha256: String,
    val width: Int,
    val height: Int,
    val mimeType: String = "image/jpeg",
) {
    fun isValid(): Boolean = canonicalUuid(id) != null && filename == "$id.jpg" &&
        byteCount in 1..PhotoPolicy.MAX_UPLOAD_BYTES && sha256.matches(Regex("[a-f0-9]{64}")) &&
        width in 1..PhotoPolicy.SERVER_MAX_EDGE && height in 1..PhotoPolicy.SERVER_MAX_EDGE &&
        width.toLong() * height <= PhotoPolicy.SERVER_MAX_PIXELS && mimeType == "image/jpeg"
}

internal fun canonicalUuid(value: String): String? {
    if (!value.matches(Regex("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}"))) return null
    return runCatching { UUID.fromString(value).toString() }.getOrNull()
}

sealed class PhotoFailure(message: String) : Exception(message) {
    class Unsupported : PhotoFailure("Unsupported or damaged image")
    class TooLarge : PhotoFailure("Image exceeds supported limits")
    class Storage : PhotoFailure("Could not save selected image")
    class Missing : PhotoFailure("Saved image is missing or changed")
}
