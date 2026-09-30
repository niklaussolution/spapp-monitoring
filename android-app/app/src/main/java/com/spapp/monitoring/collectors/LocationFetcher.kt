package com.spapp.monitoring.collectors

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * One-shot on-demand location fetch — triggered by an admin "Check Location
 * Now" command, never a continuous background stream. See docs, section 4.1.
 */
class LocationFetcher(private val context: Context) {

    companion object {
        private const val TAG = "LocationFetcher"
    }

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** Returns null if permission is missing or no fix could be obtained by either method. */
    suspend fun fetchCurrentLocation(): Location? {
        if (!hasPermission()) return null

        // getCurrentLocation() can complete "successfully" with a null Location
        // (no fix available yet — common right after boot, or on an emulator/
        // device whose location provider hasn't been "warmed up"). Fall back to
        // the last cached fix rather than reporting no location at all.
        return fetchFreshLocation() ?: fetchLastKnownLocation()
    }

    private suspend fun fetchFreshLocation(): Location? {
        val client = LocationServices.getFusedLocationProviderClient(context)
        val cancellationSource = CancellationTokenSource()

        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { cancellationSource.cancel() }

            try {
                client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cancellationSource.token)
                    .addOnSuccessListener { location ->
                        Log.d(TAG, "getCurrentLocation success: $location")
                        continuation.resume(location)
                    }
                    .addOnFailureListener { e ->
                        Log.e(TAG, "getCurrentLocation failed", e)
                        continuation.resume(null)
                    }
            } catch (e: SecurityException) {
                Log.e(TAG, "getCurrentLocation SecurityException", e)
                continuation.resume(null)
            }
        }
    }

    private suspend fun fetchLastKnownLocation(): Location? {
        val client = LocationServices.getFusedLocationProviderClient(context)
        return suspendCancellableCoroutine { continuation ->
            try {
                client.lastLocation
                    .addOnSuccessListener { location ->
                        Log.d(TAG, "getLastLocation fallback: $location")
                        continuation.resume(location)
                    }
                    .addOnFailureListener { e ->
                        Log.e(TAG, "getLastLocation failed", e)
                        continuation.resume(null)
                    }
            } catch (e: SecurityException) {
                continuation.resume(null)
            }
        }
    }
}
