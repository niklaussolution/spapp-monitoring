package com.spapp.monitoring.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Background sync — runs a pass, then re-arms the next one (see
 * SyncScheduler.CHAIN_INTERVAL). Also triggered on-demand by an FCM push.
 * Delegates the actual work to [SyncRunner] so there's one implementation
 * shared by both triggers. No foreground service, no persistent
 * notification — sync status is shown as plain text on the main screen
 * instead.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val success = try {
            SyncRunner(applicationContext).runOnce()
        } catch (e: Exception) {
            false
        }
        // Re-arm regardless of outcome — a failed pass (e.g. no network right
        // now) shouldn't break the chain; the next link retries in its own
        // right rather than this one looping via Result.retry().
        SyncScheduler.scheduleNextChainLink(applicationContext)
        return if (success) Result.success() else Result.failure()
    }
}
