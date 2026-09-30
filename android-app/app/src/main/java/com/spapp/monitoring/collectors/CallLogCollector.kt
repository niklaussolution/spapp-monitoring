package com.spapp.monitoring.collectors

import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import androidx.core.content.ContextCompat
import com.spapp.monitoring.data.local.CallLogEntry

/** Reads call metadata only (number, direction, duration) — no audio, ever. */
class CallLogCollector(private val context: Context) {

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_CALL_LOG) ==
            PackageManager.PERMISSION_GRANTED

    /** Returns call log entries strictly newer than [sinceEpochMs] (exclusive), cap of 500 per run. */
    fun collectSince(sinceEpochMs: Long): List<CallLogEntry> {
        if (!hasPermission()) return emptyList()

        val entries = mutableListOf<CallLogEntry>()
        val projection = arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.TYPE)
        val selection = "${CallLog.Calls.DATE} > ?"
        val selectionArgs = arrayOf(sinceEpochMs.toString())

        context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            projection,
            selection,
            selectionArgs,
            "${CallLog.Calls.DATE} ASC"
        )?.use { cursor ->
            // Not every OEM's CallLog/Sms provider accepts a "LIMIT" token in the
            // sortOrder string (some throw IllegalArgumentException) — cap in-memory instead.
            val numberIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER)
            val dateIdx = cursor.getColumnIndex(CallLog.Calls.DATE)
            val durationIdx = cursor.getColumnIndex(CallLog.Calls.DURATION)
            val typeIdx = cursor.getColumnIndex(CallLog.Calls.TYPE)

            while (cursor.moveToNext() && entries.size < 500) {
                val number = cursor.getString(numberIdx) ?: "unknown"
                val date = cursor.getLong(dateIdx)
                val duration = cursor.getInt(durationIdx)
                val type = cursor.getInt(typeIdx)

                val direction = when (type) {
                    CallLog.Calls.INCOMING_TYPE -> "incoming"
                    CallLog.Calls.OUTGOING_TYPE -> "outgoing"
                    CallLog.Calls.MISSED_TYPE -> "missed"
                    else -> "incoming"
                }

                entries += CallLogEntry(
                    direction = direction,
                    counterparty = number,
                    durationSec = duration,
                    calledAtEpochMs = date
                )
            }
        }
        return entries
    }
}
