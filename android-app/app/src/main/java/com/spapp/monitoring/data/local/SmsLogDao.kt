package com.spapp.monitoring.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface SmsLogDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(entries: List<SmsLogEntry>)

    @Query("SELECT * FROM sms_log_entries WHERE synced = 0 LIMIT :limit")
    suspend fun getUnsynced(limit: Int = 200): List<SmsLogEntry>

    @Query("DELETE FROM sms_log_entries WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)
}
