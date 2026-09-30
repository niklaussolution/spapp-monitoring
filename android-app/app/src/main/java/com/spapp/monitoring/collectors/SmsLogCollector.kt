package com.spapp.monitoring.collectors

import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.spapp.monitoring.data.local.SmsLogEntry

/**
 * Reads SMS metadata only (sender/receiver number, timestamp) via the SMS
 * content provider — never message body text, per project scope.
 */
class SmsLogCollector(private val context: Context) {

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_SMS) ==
            PackageManager.PERMISSION_GRANTED

    /** Returns SMS metadata strictly newer than [sinceEpochMs] (exclusive), oldest-first cap of 500 per run. */
    fun collectSince(sinceEpochMs: Long): List<SmsLogEntry> {
        if (!hasPermission()) return emptyList()

        val entries = mutableListOf<SmsLogEntry>()
        val projection = arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.DATE, Telephony.Sms.TYPE)
        val selection = "${Telephony.Sms.DATE} > ?"
        val selectionArgs = arrayOf(sinceEpochMs.toString())

        context.contentResolver.query(
            Telephony.Sms.CONTENT_URI,
            projection,
            selection,
            selectionArgs,
            "${Telephony.Sms.DATE} ASC"
        )?.use { cursor ->
            // Not every OEM's Sms/CallLog provider accepts a "LIMIT" token in the
            // sortOrder string (some throw IllegalArgumentException) — cap in-memory instead.
            val addressIdx = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
            val dateIdx = cursor.getColumnIndex(Telephony.Sms.DATE)
            val typeIdx = cursor.getColumnIndex(Telephony.Sms.TYPE)

            while (cursor.moveToNext() && entries.size < 500) {
                val address = cursor.getString(addressIdx) ?: continue
                val date = cursor.getLong(dateIdx)
                val type = cursor.getInt(typeIdx)
                // Telephony.Sms.MESSAGE_TYPE_INBOX = 1 (incoming), MESSAGE_TYPE_SENT = 2 (outgoing)
                val direction = if (type == Telephony.Sms.MESSAGE_TYPE_INBOX) "incoming" else "outgoing"

                entries += SmsLogEntry(
                    direction = direction,
                    counterparty = address,
                    messageAtEpochMs = date
                )
            }
        }
        return entries
    }
}
