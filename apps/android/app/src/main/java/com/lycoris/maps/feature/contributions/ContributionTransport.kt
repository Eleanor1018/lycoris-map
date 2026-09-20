package com.lycoris.maps.feature.contributions

import com.lycoris.maps.core.data.AccountRepository
import com.lycoris.maps.core.data.SessionIdentity
import com.lycoris.maps.core.model.Marker
import com.lycoris.maps.core.network.CreateUploadRequest
import com.lycoris.maps.core.network.UploadReceipt
import com.lycoris.maps.core.network.requireBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

/** Each operation pins one verified epoch; a worker can never borrow the next user's cookie jar. */
interface ContributionTransport {
    fun identity(): SessionIdentity?
    suspend fun restoreSession()
    suspend fun create(identity: SessionIdentity, frozenJson: String, language: String): Marker
    suspend fun edit(identity: SessionIdentity, markerId: Long, frozenJson: String, language: String): Marker
    suspend fun beginUpload(identity: SessionIdentity, markerId: Long, request: CreateUploadRequest): UploadReceipt
    suspend fun uploadStatus(identity: SessionIdentity, markerId: Long, uploadId: String): UploadReceipt
    suspend fun chunk(identity: SessionIdentity, markerId: Long, uploadId: String, offset: Int, bytes: ByteArray): UploadReceipt
    suspend fun complete(identity: SessionIdentity, markerId: Long, uploadId: String): UploadReceipt
}

class AccountContributionTransport(private val accounts: AccountRepository) : ContributionTransport {
    override fun identity(): SessionIdentity? = accounts.identity()
    override suspend fun restoreSession() { accounts.restore() }
    override suspend fun create(identity: SessionIdentity, frozenJson: String, language: String): Marker =
        accounts.withAuthenticatedMutation(expectedIdentity = identity) { api, _ ->
            api.createMarkerBytes(frozenJson.toRequestBody("application/json".toMediaType()), language).requireBody()
        }
    override suspend fun edit(identity: SessionIdentity, markerId: Long, frozenJson: String, language: String): Marker =
        accounts.withAuthenticatedMutation(expectedIdentity = identity) { api, _ ->
            api.editMarkerBytes(markerId, frozenJson.toRequestBody("application/json".toMediaType()), language).requireBody()
        }
    override suspend fun beginUpload(identity: SessionIdentity, markerId: Long, request: CreateUploadRequest): UploadReceipt =
        accounts.withAuthenticatedMutation(expectedIdentity = identity) { api, _ -> api.createUpload(markerId, request).requireBody() }
    override suspend fun uploadStatus(identity: SessionIdentity, markerId: Long, uploadId: String): UploadReceipt =
        accounts.withAuthenticatedRead(expectedIdentity = identity) { api, _ -> api.uploadStatus(markerId, uploadId).requireBody() }
    override suspend fun chunk(identity: SessionIdentity, markerId: Long, uploadId: String, offset: Int, bytes: ByteArray): UploadReceipt =
        accounts.withAuthenticatedMutation(expectedIdentity = identity) { api, _ ->
            api.uploadChunk(markerId, uploadId, offset, bytes.toRequestBody("application/octet-stream".toMediaType())).requireBody()
        }
    override suspend fun complete(identity: SessionIdentity, markerId: Long, uploadId: String): UploadReceipt =
        accounts.withAuthenticatedMutation(expectedIdentity = identity) { api, _ -> api.completeUpload(markerId, uploadId).requireBody() }
}
