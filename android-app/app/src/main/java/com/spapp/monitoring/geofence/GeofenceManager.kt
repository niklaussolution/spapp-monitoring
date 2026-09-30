package com.spapp.monitoring.geofence

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.spapp.monitoring.network.GeofenceDto
import kotlinx.coroutines.tasks.await

/**
 * Registers/unregisters device boundaries with Android's native, OS-level
 * GeofencingClient — near-zero battery cost, no polling, no persistent
 * notification. See docs, section 4.2 and section 7 (battery strategy).
 */
class GeofenceManager(private val context: Context) {

    private val client: GeofencingClient = LocationServices.getGeofencingClient(context)

    fun hasPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val background = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
        } else true
        return fine && background
    }

    private val pendingIntent: PendingIntent by lazy {
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java)
        PendingIntent.getBroadcast(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
    }

    /** Replaces all currently-registered geofences with exactly this set (idempotent sync). */
    suspend fun syncGeofences(geofences: List<GeofenceDto>): Boolean {
        if (!hasPermission()) return false

        try {
            client.removeGeofences(pendingIntent).await()
        } catch (e: Exception) {
            // Nothing was registered yet — fine.
        }

        if (geofences.isEmpty()) return true

        val geofenceObjects = geofences.map { dto ->
            Geofence.Builder()
                .setRequestId(dto.id)
                .setCircularRegion(dto.latitude, dto.longitude, dto.radiusM.toFloat())
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
                .build()
        }

        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofences(geofenceObjects)
            .build()

        return try {
            client.addGeofences(request, pendingIntent).await()
            true
        } catch (e: SecurityException) {
            false
        } catch (e: Exception) {
            false
        }
    }
}
