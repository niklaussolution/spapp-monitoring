package com.spapp.monitoring.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface WebHistoryDao {
    @Insert
    suspend fun insert(entry: WebHistoryEntry)

    @Query("SELECT * FROM web_history_entries WHERE synced = 0 LIMIT :limit")
    suspend fun getUnsynced(limit: Int = 200): List<WebHistoryEntry>

    @Query("DELETE FROM web_history_entries WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)
}
