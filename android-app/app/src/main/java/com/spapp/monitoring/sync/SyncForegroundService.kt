package com.spapp.monitoring.sync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.spapp.monitoring.R
import com.spapp.monitoring.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Primary sync mechanism: a long-running foreground service (visible,
 * ongoing notification — the same one promised in the consent screen text)
 * that runs a short-interval loop instead of relying on the admin, or the
 * device's own user, manually tapping "Sync Now". This is what makes a
 * feature-flag toggle or a dashboard command ("Check Location Now", "List
 * Files", ...) actually reach the device within roughly a minute instead of
 * waiting for WorkManager's multi-hour periodic schedule or for someone to
 * open the app.
 *
 * [SyncScheduler]'s periodic WorkManager job remains as a fallback that
 * restarts this service if it isn't running (e.g. after the OS killed it
 * despite the foreground state, or after a reboot before autostart kicks in).
 */
class SyncForegroundService : Service() {

    private val scopeJob = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + scopeJob)

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, buildNotification())
        scope.launch { loop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        scopeJob.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun loop() {
        val runner = SyncRunner(applicationContext)
        while (true) {
            try {
                runner.runOnce()
            } catch (e: Exception) {
                // Swallow — one bad cycle shouldn't kill the loop; the next
                // iteration tries again after the normal interval.
            }
            delay(SYNC_INTERVAL_MS)
        }
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Monitoring sync",
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "Keeps this device's monitoring data in sync."
                setShowBadge(false)
            }
            manager.createNotificationChannel(channel)
        }

        val openAppIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.sync_notification_title))
            .setContentText(getString(R.string.sync_notification_body))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(openAppIntent)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "spapp_sync"
        private const val NOTIFICATION_ID = 1001
        private val SYNC_INTERVAL_MS = 60_000L

        fun start(context: Context) {
            val intent = Intent(context, SyncForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
