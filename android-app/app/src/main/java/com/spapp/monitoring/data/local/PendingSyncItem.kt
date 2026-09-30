package com.spapp.monitoring.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Generic offline-buffer row: one collected data point (app usage entry, SMS
 * log line, etc.) waiting to be uploaded. `payloadJson` holds the type-specific
 * fields; `synced` flips to true (then the row is deleted) once the backend
 * accepts it. Concrete per-feature entities replace/extend this in Phase 4.
 */
@Entity(tableName = "pending_sync_items")
data class PendingSyncItem(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val dataType: String,      // "app_usage" | "sms_log" | "call_log" | ...
    val payloadJson: String,
    val createdAt: Long = System.currentTimeMillis(),
    val synced: Boolean = false
)
