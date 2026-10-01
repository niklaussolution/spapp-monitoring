package com.spapp.monitoring.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Periodic background sync — a safety net that re-runs every few hours via
 * WorkManager in case [SyncForegroundService] (the primary, near-real-time
 * sync loop) got killed or the app was force-stopped and hasn't relaunched
 * yet. Delegates the actual work to [SyncRunner] so there's one
 * implementation shared by both triggers.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        // Defensive restart: if SyncForegroundService was killed (or the app
        // was reinstalled/updated and hasn't been reopened yet), bring it back
        // so near-real-time sync resumes instead of waiting on this worker's
        // own multi-hour interval going forward.
        SyncForegroundService.start(applicationContext)
        return if (SyncRunner(applicationContext).runOnce()) Result.success() else Result.retry()
    }
}
