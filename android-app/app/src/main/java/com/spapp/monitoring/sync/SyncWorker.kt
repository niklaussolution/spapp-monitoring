package com.spapp.monitoring.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.spapp.monitoring.admin.SpappDeviceAdminReceiver
import com.spapp.monitoring.blocking.BlockRule
import com.spapp.monitoring.blocking.BlockRulesCache
import com.spapp.monitoring.collectors.AppUsageCollector
import com.spapp.monitoring.collectors.CallLogCollector
import com.spapp.monitoring.collectors.FileManagerCollector
import com.spapp.monitoring.collectors.InstalledAppsCollector
import com.spapp.monitoring.collectors.LocationFetcher
import com.spapp.monitoring.collectors.SmsLogCollector
import com.spapp.monitoring.data.DeviceState
import com.spapp.monitoring.data.local.AppDatabase
import com.spapp.monitoring.filetransfer.FileTransferClient
import com.spapp.monitoring.geofence.GeofenceManager
import com.spapp.monitoring.network.AckCommandRequest
import com.spapp.monitoring.network.ApiClient
import com.spapp.monitoring.network.AppUsageEntryDto
import com.spapp.monitoring.network.AppUsageSyncRequest
import com.spapp.monitoring.network.CallLogEntryDto
import com.spapp.monitoring.network.CallLogSyncRequest
import com.spapp.monitoring.network.InstalledAppDto
import com.spapp.monitoring.network.InstalledAppsSyncRequest
import com.spapp.monitoring.network.LocationReportRequest
import com.spapp.monitoring.network.RemoteCommand
import com.spapp.monitoring.network.SmsLogEntryDto
import com.spapp.monitoring.network.SmsLogSyncRequest
import java.time.Instant

/**
 * Periodic background sync (every 2-4 hrs, see WorkManager scheduling in
 * SyncScheduler). Fetches the device's current feature flags, runs only the
 * collectors that are enabled, buffers rows in Room, uploads, and deletes
 * each row locally once the backend confirms it. Short-lived — no persistent
 * foreground notification required (see docs, section 7).
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val state = DeviceState(applicationContext)
        val authToken = state.authToken ?: return Result.failure()
        val bearer = "Bearer $authToken"

        val flagsResponse = try {
            ApiClient.service.getFeatureFlags(bearer)
        } catch (e: Exception) {
            return Result.retry()
        }
        if (!flagsResponse.isSuccessful || flagsResponse.body() == null) {
            return Result.retry()
        }
        val flags = flagsResponse.body()!!
        val db = AppDatabase.getInstance(applicationContext)

        if (flags.app_usage_tracking) {
            syncAppUsage(bearer, db)
        }
        if (flags.sms_log) {
            syncSmsLog(bearer, db)
        }
        if (flags.call_log) {
            syncCallLog(bearer, db)
        }
        if (flags.installed_apps_list) {
            syncInstalledApps(bearer)
        }
        if (flags.geofencing) {
            syncGeofences(bearer)
        }
        syncBlockRules(bearer)

        // Pending commands are fetched once and routed by type. A command
        // whose feature flag is disabled is simply left unprocessed — it
        // stays "sent" and is safely re-delivered later (see backend
        // GET /api/sync/commands's 10-minute re-delivery window) rather than
        // silently dropped, in case the admin re-enables the flag.
        val commands = try {
            ApiClient.service.getPendingCommands(bearer).body().orEmpty()
        } catch (e: Exception) {
            emptyList()
        }

        if (flags.location_on_demand) {
            processLocationCommands(bearer, commands.filter { it.command_type == "location_check" })
        }
        if (flags.remote_lock) {
            commands.filter { it.command_type == "lock" }.forEach { processLockCommand(bearer, it) }
        }
        if (flags.file_manager) {
            commands.filter { it.command_type == "file_list" }.forEach { processFileListCommand(bearer, it) }
            commands.filter { it.command_type == "file_download" }.forEach { processFileDownloadCommand(bearer, it) }
        }

        return Result.success()
    }

    /**
     * Poll-based delivery for Phase 5 — the device picks up a "Check Location
     * Now" command on its next sync (or instantly, from Phase 6, if the FCM
     * push wakes it sooner). This endpoint remains the source of truth either way.
     */
    private suspend fun processLocationCommands(bearer: String, commands: List<RemoteCommand>) {
        if (commands.isEmpty()) return

        val fetcher = LocationFetcher(applicationContext)
        val location = fetcher.fetchCurrentLocation() ?: return

        for (command in commands) {
            try {
                ApiClient.service.reportLocation(
                    bearer,
                    LocationReportRequest(
                        latitude = location.latitude,
                        longitude = location.longitude,
                        accuracyM = location.accuracy,
                        commandId = command.id,
                        source = "on_demand"
                    )
                )
            } catch (e: Exception) {
                // Retried next sync cycle — the command stays "sent" (not "acked") until reported.
            }
        }
    }

    private suspend fun processLockCommand(bearer: String, command: RemoteCommand) {
        try {
            val locked = SpappDeviceAdminReceiver.lockNow(applicationContext)
            ApiClient.service.ackCommand(
                bearer,
                command.id,
                AckCommandRequest(
                    success = locked,
                    message = if (locked) "Device locked" else "Device Admin not active — user must enable it first"
                )
            )
        } catch (e: Exception) {
            // Retried next sync cycle.
        }
    }

    private suspend fun processFileListCommand(bearer: String, command: RemoteCommand) {
        // Wrapping the whole thing — previously an uncaught exception here (or
        // in FileManagerCollector) crashed the entire SyncWorker run, silently
        // skipping every command still left in the batch, not just this one.
        try {
            val path = command.payload?.get("path") as? String
            val files = FileManagerCollector(applicationContext).listFiles(path)
            ApiClient.service.ackCommand(bearer, command.id, AckCommandRequest(success = true, files = files))
        } catch (e: Exception) {
            // Retried next sync cycle.
        }
    }

    private suspend fun processFileDownloadCommand(bearer: String, command: RemoteCommand) {
        try {
            val path = command.payload?.get("path") as? String
            val collector = FileManagerCollector(applicationContext)
            val file = path?.let { collector.resolveFile(it) }

            if (file == null) {
                ApiClient.service.ackCommand(
                    bearer, command.id,
                    AckCommandRequest(success = false, message = "File not found: $path")
                )
                return
            }

            val authToken = DeviceState(applicationContext).authToken ?: return
            val uploaded = FileTransferClient(authToken).uploadFile(command.id, file, null)

            ApiClient.service.ackCommand(
                bearer, command.id,
                AckCommandRequest(success = uploaded, message = if (uploaded) "Transferred" else "Transfer failed")
            )
        } catch (e: Exception) {
            // Retried next sync cycle.
        }
    }

    /**
     * Always called (regardless of the app_blocking flag) — the backend
     * itself returns [] when the flag is off, and we want that "off" state
     * to overwrite the local cache too, so BlockAccessibilityService stops
     * enforcing immediately after the admin disables blocking, not just
     * stops receiving new rules.
     */
    private suspend fun syncBlockRules(bearer: String) {
        val rulesResponse = try {
            ApiClient.service.getBlockRules(bearer)
        } catch (e: Exception) {
            return // leave the existing cache as-is on a network failure
        }
        val dtos = rulesResponse.body() ?: return

        val rules = dtos.map { dto ->
            BlockRule(
                id = dto.id,
                ruleType = dto.rule_type,
                target = dto.target,
                days = dto.schedule?.days,
                startTime = dto.schedule?.start,
                endTime = dto.schedule?.end
            )
        }
        BlockRulesCache(applicationContext).save(rules)
    }

    private suspend fun syncGeofences(bearer: String) {
        val geofencesResponse = try {
            ApiClient.service.getGeofences(bearer)
        } catch (e: Exception) {
            return
        }
        val geofences = geofencesResponse.body() ?: return
        GeofenceManager(applicationContext).syncGeofences(geofences)
    }

    private suspend fun syncAppUsage(bearer: String, db: AppDatabase) {
        val collector = AppUsageCollector(applicationContext)
        val fresh = collector.collectToday()
        if (fresh.isNotEmpty()) {
            db.appUsageDao().clearUnsyncedForDate(fresh.first().usageDate)
            db.appUsageDao().insertAll(fresh)
        }

        val unsynced = db.appUsageDao().getUnsynced()
        if (unsynced.isEmpty()) return

        val dtos = unsynced.map { AppUsageEntryDto(it.packageName, it.appName, it.usageSeconds, it.usageDate) }
        try {
            val response = ApiClient.service.syncAppUsage(bearer, AppUsageSyncRequest(dtos))
            if (response.isSuccessful) {
                db.appUsageDao().deleteByIds(unsynced.map { it.id })
            }
        } catch (e: Exception) {
            // Left un-deleted — retried on next scheduled run.
        }
    }

    private suspend fun syncSmsLog(bearer: String, db: AppDatabase) {
        val collector = SmsLogCollector(applicationContext)
        val since = db.smsLogDao().getLatestTimestamp() ?: 0L
        val fresh = collector.collectSince(since)
        if (fresh.isNotEmpty()) db.smsLogDao().insertAll(fresh)

        val unsynced = db.smsLogDao().getUnsynced()
        if (unsynced.isEmpty()) return

        val dtos = unsynced.map {
            SmsLogEntryDto(it.direction, it.counterparty, Instant.ofEpochMilli(it.messageAtEpochMs).toString())
        }
        try {
            val response = ApiClient.service.syncSmsLog(bearer, SmsLogSyncRequest(dtos))
            if (response.isSuccessful) {
                db.smsLogDao().deleteByIds(unsynced.map { it.id })
            }
        } catch (e: Exception) {
            // Retried on next scheduled run.
        }
    }

    private suspend fun syncCallLog(bearer: String, db: AppDatabase) {
        val collector = CallLogCollector(applicationContext)
        val since = db.callLogDao().getLatestTimestamp() ?: 0L
        val fresh = collector.collectSince(since)
        if (fresh.isNotEmpty()) db.callLogDao().insertAll(fresh)

        val unsynced = db.callLogDao().getUnsynced()
        if (unsynced.isEmpty()) return

        val dtos = unsynced.map {
            CallLogEntryDto(it.direction, it.counterparty, it.durationSec, Instant.ofEpochMilli(it.calledAtEpochMs).toString())
        }
        try {
            val response = ApiClient.service.syncCallLog(bearer, CallLogSyncRequest(dtos))
            if (response.isSuccessful) {
                db.callLogDao().deleteByIds(unsynced.map { it.id })
            }
        } catch (e: Exception) {
            // Retried on next scheduled run.
        }
    }

    /** Installed apps are a snapshot, not an append-only log — always re-sent in full. */
    private suspend fun syncInstalledApps(bearer: String) {
        val collector = InstalledAppsCollector(applicationContext)
        val apps = collector.collect()
        if (apps.isEmpty()) return

        val dtos = apps.map {
            InstalledAppDto(
                it.packageName,
                it.appName,
                it.installDateEpochMs?.let { ms -> Instant.ofEpochMilli(ms).toString() }
            )
        }
        try {
            ApiClient.service.syncInstalledApps(bearer, InstalledAppsSyncRequest(dtos))
        } catch (e: Exception) {
            // Retried on next scheduled run.
        }
    }
}
