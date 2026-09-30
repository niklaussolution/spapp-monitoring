package com.spapp.monitoring.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface AppUsageDao {
    @Insert
    suspend fun insertAll(entries: List<AppUsageEntry>)

    @Query("SELECT * FROM app_usage_entries WHERE synced = 0 LIMIT :limit")
    suspend fun getUnsynced(limit: Int = 200): List<AppUsageEntry>

    @Query("DELETE FROM app_usage_entries WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)

    /**
     * Each collection run reports today's CUMULATIVE total per package, not a
     * delta. Clear any not-yet-uploaded rows for today before inserting the
     * fresh snapshot, so a prior failed sync doesn't leave stale duplicates.
     */
    @Query("DELETE FROM app_usage_entries WHERE usageDate = :date AND synced = 0")
    suspend fun clearUnsyncedForDate(date: String)
}
