package com.spapp.monitoring.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * URL captured from a supported browser's address bar via
 * BlockAccessibilityService — see its doc comment for why this is the real
 * data source, not WebHistoryCollector's legacy content-provider query
 * (modern Chrome exposes no history API to third-party apps at all).
 */
@Entity(tableName = "web_history_entries")
data class WebHistoryEntry(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val url: String,
    val visitedAtEpochMs: Long,
    val synced: Boolean = false
)
