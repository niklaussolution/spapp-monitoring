package com.spapp.monitoring.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "sms_log_entries")
data class SmsLogEntry(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val direction: String, // "incoming" | "outgoing"
    val counterparty: String,
    val messageAtEpochMs: Long,
    val body: String? = null,
    val synced: Boolean = false,
    // The SMS content provider's own stable, monotonically increasing row ID
    // (Telephony.Sms._ID). Used as a high-water mark so sync picks up newly
    // arrived messages incrementally instead of re-scanning the device's
    // entire multi-year SMS history from the oldest message forward every
    // time — see DeviceState.smsLastExternalId.
    val externalId: Long = 0
)
