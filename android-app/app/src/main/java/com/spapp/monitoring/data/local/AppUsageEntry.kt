package com.spapp.monitoring.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/** Local buffer row for one app's usage on one day, before it is synced and deleted. */
@Entity(tableName = "app_usage_entries")
data class AppUsageEntry(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val packageName: String,
    val appName: String?,
    val usageSeconds: Long,
    val usageDate: String, // "YYYY-MM-DD"
    val synced: Boolean = false
)
