package com.spapp.monitoring.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface PendingSyncDao {
    @Insert
    suspend fun insert(item: PendingSyncItem): Long

    @Query("SELECT * FROM pending_sync_items WHERE synced = 0 ORDER BY createdAt ASC LIMIT :limit")
    suspend fun getUnsynced(limit: Int = 100): List<PendingSyncItem>

    @Query("DELETE FROM pending_sync_items WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("SELECT COUNT(*) FROM pending_sync_items WHERE synced = 0")
    suspend fun unsyncedCount(): Int
}
