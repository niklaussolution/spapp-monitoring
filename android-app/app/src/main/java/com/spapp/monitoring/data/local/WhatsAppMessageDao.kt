package com.spapp.monitoring.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface WhatsAppMessageDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(entries: List<WhatsAppMessageEntry>)

    @Query("SELECT * FROM whatsapp_message_entries WHERE synced = 0 ORDER BY messageTimeEpochMs ASC LIMIT :limit")
    suspend fun getUnsynced(limit: Int = 200): List<WhatsAppMessageEntry>

    @Query("DELETE FROM whatsapp_message_entries WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)
}
