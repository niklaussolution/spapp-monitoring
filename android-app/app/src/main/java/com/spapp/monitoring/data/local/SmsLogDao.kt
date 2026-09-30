package com.spapp.monitoring.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface SmsLogDao {
    @Insert
    suspend fun insertAll(entries: List<SmsLogEntry>)

    @Query("SELECT * FROM sms_log_entries WHERE synced = 0 LIMIT :limit")
    suspend fun getUnsynced(limit: Int = 200): List<SmsLogEntry>

    @Query("DELETE FROM sms_log_entries WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)

    @Query("SELECT MAX(messageAtEpochMs) FROM sms_log_entries")
    suspend fun getLatestTimestamp(): Long?
}
