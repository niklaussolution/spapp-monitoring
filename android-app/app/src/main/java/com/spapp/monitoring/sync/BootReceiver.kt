package com.spapp.monitoring.sync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.spapp.monitoring.data.DeviceState

/**
 * RECEIVE_BOOT_COMPLETED was already declared in the manifest but nothing
 * ever listened for it, so after a reboot neither the foreground sync service
 * nor the WorkManager periodic job restarted on their own until the user
 * happened to reopen the app. WorkManager itself normally re-arms enqueued
 * periodic work on boot, but the foreground service does not — it has to be
 * explicitly started again.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val state = DeviceState(context)
        if (state.authToken == null) return // not activated yet — nothing to sync

        SyncScheduler.schedule(context)
        SyncForegroundService.start(context)
    }
}
