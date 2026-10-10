package com.spapp.monitoring.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "sms_log_entries",
    indices = [Index(value = ["direction", "counterparty", "messageAtEpochMs"], unique = true)]
)
data class SmsLogEntry(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val direction: String, // "incoming" | "outgoing"
    val counterparty: String,
    val messageAtEpochMs: Long,
    val body: String? = null,
    val synced: Boolean = false,
    val externalId: Long = 0,
    val contactName: String? = null
)
