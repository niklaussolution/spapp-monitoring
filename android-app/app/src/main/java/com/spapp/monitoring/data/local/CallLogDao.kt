package com.spapp.monitoring.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface CallLogDao {
    @Insert
    suspend fun insertAll(entries: List<CallLogEntry>)

    @Query("SELECT * FROM call_log_entries WHERE synced = 0 LIMIT :limit")
    suspend fun getUnsynced(limit: Int = 200): List<CallLogEntry>

    @Query("DELETE FROM call_log_entries WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)

    @Query("SELECT MAX(calledAtEpochMs) FROM call_log_entries")
    suspend fun getLatestTimestamp(): Long?
}
