package com.spapp.monitoring.geofence

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent

/**
 * Fired by the OS (not our app) when a registered geofence boundary is
 * crossed. Kept minimal — hands off to a WorkManager job immediately, since
 * a BroadcastReceiver must return fast and shouldn't make network calls itself.
 */
class GeofenceBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) return

        val transition = when (event.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> "enter"
            Geofence.GEOFENCE_TRANSITION_EXIT -> "exit"
            else -> return // ignore DWELL and any other transition type we didn't request
        }

        val location = event.triggeringLocation ?: return
        val triggeringGeofences = event.triggeringGeofences ?: return

        for (geofence in triggeringGeofences) {
            val data = Data.Builder()
                .putString(GeofenceEventWorker.KEY_GEOFENCE_ID, geofence.requestId)
                .putString(GeofenceEventWorker.KEY_TRANSITION, transition)
                .putDouble(GeofenceEventWorker.KEY_LATITUDE, location.latitude)
                .putDouble(GeofenceEventWorker.KEY_LONGITUDE, location.longitude)
                .build()

            val request = OneTimeWorkRequestBuilder<GeofenceEventWorker>()
                .setInputData(data)
                .build()

            WorkManager.getInstance(context).enqueue(request)
        }
    }
}
