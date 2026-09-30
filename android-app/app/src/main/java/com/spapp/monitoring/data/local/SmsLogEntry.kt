package com.spapp.monitoring.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/** Metadata only — sender/receiver number and timestamp. No message content. */
@Entity(tableName = "sms_log_entries")
data class SmsLogEntry(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val direction: String, // "incoming" | "outgoing"
    val counterparty: String,
    val messageAtEpochMs: Long,
    val synced: Boolean = false
)
