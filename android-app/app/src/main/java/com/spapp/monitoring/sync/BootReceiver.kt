package com.spapp.monitoring.sync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.spapp.monitoring.data.DeviceState

/**
 * RECEIVE_BOOT_COMPLETED was already declared in the manifest but nothing
 * ever listened for it. WorkManager normally re-arms already-enqueued
 * periodic work on its own after a reboot, but re-scheduling here explicitly
 * covers the case where that enqueue never happened in the first place
 * (e.g. the app was installed and activated, then the phone rebooted before
 * MainActivity was ever opened).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val state = DeviceState(context)
        if (state.authToken == null) return // not activated yet — nothing to sync

        SyncScheduler.schedule(context)
    }
}
