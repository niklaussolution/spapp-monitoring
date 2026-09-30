package com.spapp.monitoring.fcm

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.spapp.monitoring.data.DeviceState
import com.spapp.monitoring.sync.SyncScheduler

/**
 * Receives FCM push messages — this is what makes "Check Location Now" /
 * remote lock / etc. instant instead of waiting for the next periodic poll
 * (Phase 5's fallback). We only ever send silent DATA messages (no visible
 * notification content), since the actual command payload always lives in
 * the backend's `remote_commands` table — the push is just a wake-up nudge,
 * never a place we'd put sensitive data.
 */
class SpappFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        FcmTokenSync.enqueueUpload(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)

        val authToken = DeviceState(applicationContext).authToken
        if (authToken.isNullOrEmpty()) return // not activated yet — ignore

        // Every push we send is a "go sync now" nudge; SyncWorker itself
        // decides what to do based on pending commands + feature flags.
        when (message.data["type"]) {
            "command", "sync" -> SyncScheduler.runOnce(applicationContext)
            else -> SyncScheduler.runOnce(applicationContext)
        }
    }
}
