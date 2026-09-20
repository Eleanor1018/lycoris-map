package com.lycoris.maps.feature.contributions

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.Operation
import androidx.work.WorkManager
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.security.MessageDigest
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine

interface ContributionScheduler {
    suspend fun enqueue(draft: ContributionDraft, replace: Boolean = false)
    suspend fun cancel(id: String)
    suspend fun cancelOwner(origin: String, owner: String)
}

/** WorkData contains only an opaque draft UUID; credentials and photographs stay in private storage. */
class WorkContributionScheduler(context: Context) : ContributionScheduler {
    private val applicationContext = context.applicationContext
    private val manager get() = WorkManager.getInstance(applicationContext)
    override suspend fun enqueue(draft: ContributionDraft, replace: Boolean) {
        require(draft.safelyResumable && !draft.paused)
        val request = OneTimeWorkRequestBuilder<ContributionWorker>()
            .setInputData(workDataOf(ContributionWorker.DRAFT_ID to draft.id))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag(ownerTag(draft.origin, draft.owner))
            .build()
        manager.enqueueUniqueWork(workName(draft.id), if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP, request).completed()
    }
    override suspend fun cancel(id: String) { manager.cancelUniqueWork(workName(id)).completed() }
    override suspend fun cancelOwner(origin: String, owner: String) { manager.cancelAllWorkByTag(ownerTag(origin, owner)).completed() }
    private fun workName(id: String) = "contribution-$id"
    private fun ownerTag(origin: String, owner: String): String = "contribution-owner-" + MessageDigest.getInstance("SHA-256")
        .digest("$origin\u0000$owner".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    private suspend fun Operation.completed() = suspendCancellableCoroutine { continuation ->
        val future = result
        future.addListener({
            if (continuation.isActive) {
                try { future.get(); continuation.resume(Unit) }
                catch (failure: Exception) { continuation.resumeWithException(failure) }
            }
        }, Executor { it.run() })
    }
}

class ContributionWorker(
    context: Context,
    parameters: WorkerParameters,
    private val engine: ContributionEngine,
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val id = inputData.getString(DRAFT_ID) ?: return Result.failure()
        return try {
            when (engine.resume(id)) {
                ContributionRunResult.DONE, ContributionRunResult.PAUSED -> Result.success()
                ContributionRunResult.RETRY -> if (runAttemptCount < ContributionEngine.MAX_RETRIES) Result.retry() else Result.failure()
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { Result.failure() } // A corrupt/unwritable database must not provoke a blind mutation retry.
    }
    companion object { const val DRAFT_ID = "draft_id" }
}

class ContributionWorkerFactory(private val engine: () -> ContributionEngine) : WorkerFactory() {
    override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker? =
        if (workerClassName == ContributionWorker::class.java.name) ContributionWorker(appContext, workerParameters, engine()) else null
}
