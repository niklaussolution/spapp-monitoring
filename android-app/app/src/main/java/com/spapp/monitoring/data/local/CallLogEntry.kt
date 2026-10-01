package com.spapp.monitoring.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/** Metadata only — number, direction, duration, timestamp. No audio, no recording. */
@Entity(tableName = "call_log_entries")
data class CallLogEntry(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val direction: String, // "incoming" | "outgoing" | "missed"
    val counterparty: String,
    val durationSec: Int,
    val calledAtEpochMs: Long,
    val synced: Boolean = false,
    // CallLog.Calls' own stable, monotonically increasing row ID — same
    // high-water-mark purpose as SmsLogEntry.externalId.
    val externalId: Long = 0
)
