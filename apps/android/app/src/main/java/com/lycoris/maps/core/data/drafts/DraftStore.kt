package com.lycoris.maps.core.data.drafts

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import com.lycoris.maps.feature.contributions.ContributionDraft
import com.lycoris.maps.feature.contributions.DraftStorageFailure
import com.lycoris.maps.core.network.LycorisJson
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.encodeToString

interface DraftStore {
    fun observe(origin: String, owner: String): Flow<List<ContributionDraft>>
    suspend fun get(id: String): ContributionDraft?
    suspend fun list(origin: String, owner: String): List<ContributionDraft>
    suspend fun insert(draft: ContributionDraft)
    suspend fun update(expected: ContributionDraft, next: ContributionDraft): ContributionDraft
    suspend fun delete(expected: ContributionDraft)
}

/** Shared by coordinator and worker engine, so local edits cannot race a live upload. */
class DraftLocks {
    private val locks = ConcurrentHashMap<String, Mutex>()
    fun forDraft(id: String): Mutex = locks.getOrPut(id) { Mutex() }
}

@Entity(tableName = "contribution_drafts", indices = [Index(value = ["origin", "owner"])])
data class DraftEntity(
    @PrimaryKey val id: String,
    val origin: String,
    val owner: String,
    val revision: Long,
    val updatedAt: Long,
    val payload: String,
)

@Dao
interface DraftDao {
    @Query("SELECT * FROM contribution_drafts WHERE origin = :origin AND owner = :owner ORDER BY updatedAt DESC")
    fun observe(origin: String, owner: String): Flow<List<DraftEntity>>
    @Query("SELECT * FROM contribution_drafts WHERE id = :id")
    suspend fun get(id: String): DraftEntity?
    @Query("SELECT * FROM contribution_drafts WHERE origin = :origin AND owner = :owner ORDER BY updatedAt DESC")
    suspend fun list(origin: String, owner: String): List<DraftEntity>
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(entity: DraftEntity)
    @Query("UPDATE contribution_drafts SET payload = :payload, revision = :nextRevision, updatedAt = :updatedAt WHERE id = :id AND origin = :origin AND owner = :owner AND revision = :expectedRevision")
    suspend fun update(id: String, origin: String, owner: String, expectedRevision: Long, nextRevision: Long, updatedAt: Long, payload: String): Int
    @Query("DELETE FROM contribution_drafts WHERE id = :id AND origin = :origin AND owner = :owner AND revision = :revision")
    suspend fun delete(id: String, origin: String, owner: String, revision: Long): Int
}

@Database(entities = [DraftEntity::class], version = 1, exportSchema = true)
abstract class ContributionDatabase : RoomDatabase() {
    abstract fun drafts(): DraftDao
    companion object {
        fun open(context: Context): ContributionDatabase = Room.databaseBuilder(
            context.applicationContext, ContributionDatabase::class.java,
            File(context.noBackupFilesDir, "contribution-drafts.db").absolutePath,
        ).build() // No destructive migration: losing an idempotency receipt can duplicate a contribution.
    }
}

class RoomDraftStore(private val dao: DraftDao) : DraftStore {
    override fun observe(origin: String, owner: String): Flow<List<ContributionDraft>> =
        dao.observe(origin, owner).map { values -> values.map(::decode) }
    override suspend fun get(id: String): ContributionDraft? = dao.get(id)?.let(::decode)
    override suspend fun list(origin: String, owner: String): List<ContributionDraft> = dao.list(origin, owner).map(::decode)
    override suspend fun insert(draft: ContributionDraft) { dao.insert(encode(draft)) }
    override suspend fun update(expected: ContributionDraft, next: ContributionDraft): ContributionDraft {
        if (expected.id != next.id || expected.owner != next.owner || expected.origin != next.origin) throw DraftStorageFailure()
        val saved = next.copy(revision = expected.revision + 1, updatedAt = System.currentTimeMillis())
        val entity = encode(saved)
        if (dao.update(entity.id, entity.origin, entity.owner, expected.revision, entity.revision, entity.updatedAt, entity.payload) != 1) throw DraftStorageFailure()
        return saved
    }
    override suspend fun delete(expected: ContributionDraft) {
        if (dao.delete(expected.id, expected.origin, expected.owner, expected.revision) != 1) throw DraftStorageFailure()
    }
    private fun encode(draft: ContributionDraft): DraftEntity {
        if (!draft.isValidCheckpoint()) throw DraftStorageFailure()
        return DraftEntity(draft.id, draft.origin, draft.owner, draft.revision, draft.updatedAt, LycorisJson.encodeToString(draft))
    }
    private fun decode(entity: DraftEntity): ContributionDraft = try {
        LycorisJson.decodeFromString<ContributionDraft>(entity.payload).also {
            if (!it.isValidCheckpoint() || it.id != entity.id || it.owner != entity.owner || it.origin != entity.origin || it.revision != entity.revision) throw DraftStorageFailure()
        }
    } catch (_: Exception) { throw DraftStorageFailure() }
}
