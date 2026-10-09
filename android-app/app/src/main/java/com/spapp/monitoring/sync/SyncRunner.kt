package com.spapp.monitoring.sync

import android.content.Context
import com.spapp.monitoring.admin.SpappDeviceAdminReceiver
import com.spapp.monitoring.blocking.BlockRule
import com.spapp.monitoring.blocking.BlockRulesCache
import com.spapp.monitoring.collectors.AppUsageCollector
import com.spapp.monitoring.collectors.CallLogCollector
import com.spapp.monitoring.collectors.FileManagerCollector
import com.spapp.monitoring.collectors.InstalledAppsCollector
import com.spapp.monitoring.collectors.LocationFetcher
import com.spapp.monitoring.collectors.PermissionStatusCollector
import com.spapp.monitoring.collectors.SmsLogCollector
import com.spapp.monitoring.collectors.WebHistoryCollector
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
import com.spapp.monitoring.network.WebHistoryEntryDto
import com.spapp.monitoring.network.WebHistorySyncRequest
import java.time.Instant

/**
 * The actual sync pass: fetch feature flags, run enabled collectors, fetch and
 * process pending commands. Shared by [SyncWorker] (the periodic WorkManager
 * fallback, every few hours) and [SyncForegroundService] (the primary,
 * near-real-time loop) so there's exactly one implementation of "what a sync
 * cycle does" regardless of what triggers it.
 */
class SyncRunner(private val context: Context) {

    /** Returns true on a completed pass (even if individual sub-steps failed softly), false to retry later. */
    suspend fun runOnce(): Boolean {
        val state = DeviceState(context)
        val authToken = state.authToken ?: return false
        val bearer = "Bearer $authToken"

        val flagsResponse = try {
            ApiClient.service.getFeatureFlags(bearer)
        } catch (e: Exception) {
            return false
        }
        if (!flagsResponse.isSuccessful || flagsResponse.body() == null) {
            return false
        }
        val flags = flagsResponse.body()!!
        val db = AppDatabase.getInstance(context)

        // Always mirrored locally (not just when true) — BlockAccessibilityService
        // reads this flag directly to decide whether to record a URL it just
        // saw, and it needs to stop recording immediately once the admin
        // turns the flag off, the same way syncBlockRules() below always
        // overwrites the local rules cache regardless of app_blocking.
        state.webHistoryTrackingEnabled = flags.web_history_tracking

        // Always sent, regardless of which flags are on — this is "can this
        // feature actually work on this device right now", not "is it
        // turned on", so the dashboard can show a real OS-level permission
        // gap (e.g. Accessibility Service never enabled) even for a scope
        // the admin hasn't toggled on yet.
        try {
            ApiClient.service.syncPermissionStatus(bearer, PermissionStatusCollector(context).collect())
        } catch (e: Exception) {
            // Retried on next scheduled run.
        }

        if (flags.app_usage_tracking) {
            syncAppUsage(bearer, db)
        }
        if (flags.web_history_tracking) {
            syncWebHistory(bearer, db)
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

        state.lastSyncAtEpochMs = System.currentTimeMillis()
        return true
    }

    private suspend fun processLocationCommands(bearer: String, commands: List<RemoteCommand>) {
        if (commands.isEmpty()) return

        val fetcher = LocationFetcher(context)
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
            val locked = SpappDeviceAdminReceiver.lockNow(context)
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
        try {
            val files = FileManagerCollector(context).listAllRecursive()
            ApiClient.service.ackCommand(bearer, command.id, AckCommandRequest(success = true, files = files))
        } catch (e: Exception) {
            // Retried next sync cycle.
        }
    }

    private suspend fun processFileDownloadCommand(bearer: String, command: RemoteCommand) {
        try {
            val path = command.payload?.get("path") as? String
            val collector = FileManagerCollector(context)
            val file = path?.let { collector.resolveFile(it) }

            if (file == null) {
                ApiClient.service.ackCommand(
                    bearer, command.id,
                    AckCommandRequest(success = false, message = "File not found: $path")
                )
                return
            }

            val authToken = DeviceState(context).authToken ?: return
            val uploaded = FileTransferClient(authToken).uploadFile(command.id, file, null)

            ApiClient.service.ackCommand(
                bearer, command.id,
                AckCommandRequest(success = uploaded, message = if (uploaded) "Transferred" else "Transfer failed")
            )
        } catch (e: Exception) {
            // Retried next sync cycle.
        }
    }

    private suspend fun syncBlockRules(bearer: String) {
        val rulesResponse = try {
            ApiClient.service.getBlockRules(bearer)
        } catch (e: Exception) {
            return
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
        BlockRulesCache(context).save(rules)
    }

    private suspend fun syncGeofences(bearer: String) {
        val geofencesResponse = try {
            ApiClient.service.getGeofences(bearer)
        } catch (e: Exception) {
            return
        }
        val geofences = geofencesResponse.body() ?: return
        GeofenceManager(context).syncGeofences(geofences)
    }

    private suspend fun syncAppUsage(bearer: String, db: AppDatabase) {
        val collector = AppUsageCollector(context)
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
        val state = DeviceState(context)
        val collector = SmsLogCollector(context)
        val fresh = collector.collectSince(state.smsLastExternalId)
        if (fresh.isNotEmpty()) {
            db.smsLogDao().insertAll(fresh)
            state.smsLastExternalId = maxOf(state.smsLastExternalId, fresh.maxOf { it.externalId })
        }

        val unsynced = db.smsLogDao().getUnsynced()
        if (unsynced.isEmpty()) return

        val dtos = unsynced.map {
            SmsLogEntryDto(it.direction, it.counterparty, Instant.ofEpochMilli(it.messageAtEpochMs).toString(), it.body)
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
        val state = DeviceState(context)
        val collector = CallLogCollector(context)
        val fresh = collector.collectSince(state.callLastExternalId)
        if (fresh.isNotEmpty()) {
            db.callLogDao().insertAll(fresh)
            state.callLastExternalId = maxOf(state.callLastExternalId, fresh.maxOf { it.externalId })
        }

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

    /**
     * Two sources, merged: (1) the local Room buffer that
     * BlockAccessibilityService fills by reading supported browsers'
     * address bars — the real working mechanism, since modern Chrome
     * exposes no history API to third-party apps at all — and (2)
     * WebHistoryCollector's legacy content-provider query, kept as a
     * secondary source for the rare OEM/legacy browser that still
     * implements it. Buffered-and-deleted like SMS/call logs, not
     * fire-and-forget, since source (1) can produce real volume.
     */
    private suspend fun syncWebHistory(bearer: String, db: AppDatabase) {
        val unsynced = db.webHistoryDao().getUnsynced()
        val legacy = WebHistoryCollector(context).collectRecent()

        val dtos = unsynced.map {
            WebHistoryEntryDto(it.url, it.title, Instant.ofEpochMilli(it.visitedAtEpochMs).toString())
        } + legacy.map {
            WebHistoryEntryDto(it.url, it.title, Instant.ofEpochMilli(it.visitedAtEpochMs).toString())
        }
        if (dtos.isEmpty()) return

        try {
            val response = ApiClient.service.syncWebHistory(bearer, WebHistorySyncRequest(dtos))
            if (response.isSuccessful && unsynced.isNotEmpty()) {
                db.webHistoryDao().deleteByIds(unsynced.map { it.id })
            }
        } catch (e: Exception) {
            // Retried on next scheduled run.
        }
    }

    /** Installed apps are a snapshot, not an append-only log — always re-sent in full. */
    private suspend fun syncInstalledApps(bearer: String) {
        val collector = InstalledAppsCollector(context)
        val apps = collector.collect()
        if (apps.isEmpty()) return

        val dtos = apps.map {
            InstalledAppDto(
                it.packageName,
                it.appName,
                it.installDateEpochMs?.let { ms -> Instant.ofEpochMilli(ms).toString() },
                it.iconBase64
            )
        }
        try {
            ApiClient.service.syncInstalledApps(bearer, InstalledAppsSyncRequest(dtos))
        } catch (e: Exception) {
            // Retried on next scheduled run.
        }
    }
}
