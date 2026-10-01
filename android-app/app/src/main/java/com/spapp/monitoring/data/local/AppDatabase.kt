package com.spapp.monitoring.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Local offline buffer. One @Entity + @Dao per data-collection module (app
 * usage, SMS log, call log); each row is deleted once its upload to the
 * backend succeeds. See docs — section "Local DB" rationale.
 */
@Database(
    entities = [
        PendingSyncItem::class, AppUsageEntry::class, SmsLogEntry::class, CallLogEntry::class,
        WebHistoryEntry::class,
    ],
    version = 4, // v4: added WebHistoryEntry (accessibility-captured browser URLs)
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun pendingSyncDao(): PendingSyncDao
    abstract fun appUsageDao(): AppUsageDao
    abstract fun smsLogDao(): SmsLogDao
    abstract fun callLogDao(): CallLogDao
    abstract fun webHistoryDao(): WebHistoryDao

    companion object {
        @Volatile private var instance: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "spapp_local_buffer.db"
                )
                    // Pre-release app, no user data worth preserving across schema
                    // changes yet — revisit with a real migration before store release.
                    .fallbackToDestructiveMigration()
                    .build().also { instance = it }
            }
    }
}
