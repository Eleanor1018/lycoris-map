package com.lycoris.maps.core.network

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Non-exportable AES key; ciphertext lives in noBackupFilesDir and is bound to this origin. */
class EncryptedCookiePersistence(context: Context, origin: String) : CookiePersistence {
    private val associatedData = origin.encodeToByteArray()
    private val digest = MessageDigest.getInstance("SHA-256").digest(associatedData)
        .joinToString("") { "%02x".format(it) }
    private val alias = "lycoris.session.$digest"
    private val file = AtomicFile(File(context.noBackupFilesDir, "session-$digest.bin"))

    @Synchronized
    override fun read(): ByteArray? {
        if (!file.baseFile.exists()) return null
        val bytes = file.openRead().use { stream ->
            if (file.baseFile.length() > 128 * 1024) throw ApiFailure.SecureStorage()
            stream.readBytes()
        }
        require(bytes.size >= 1 + 12 + 16 && bytes[0] == 1.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
        cipher.updateAAD(associatedData)
        return cipher.doFinal(bytes.copyOfRange(13, bytes.size))
    }

    @Synchronized
    override fun write(bytes: ByteArray) {
        require(bytes.size <= 96 * 1024)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(associatedData)
        val encrypted = byteArrayOf(1) + cipher.iv + cipher.doFinal(bytes)
        val stream = file.startWrite()
        try {
            stream.write(encrypted)
            file.finishWrite(stream)
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        }
    }

    @Synchronized
    override fun clear() {
        // Removing the key also invalidates any stale AtomicFile backup after a disk failure.
        try {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias)
        } finally {
            file.delete()
        }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
        }.generateKey()
    }
}
