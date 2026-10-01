package com.spapp.monitoring.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Periodic background sync (every 15 minutes, WorkManager's minimum — see
 * SyncScheduler) plus on-demand runs triggered by an FCM push. Delegates the
 * actual work to [SyncRunner] so there's one implementation shared by both
 * triggers. No foreground service, no persistent notification — sync status
 * is shown as plain text on the main screen instead.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return if (SyncRunner(applicationContext).runOnce()) Result.success() else Result.retry()
    }
}
