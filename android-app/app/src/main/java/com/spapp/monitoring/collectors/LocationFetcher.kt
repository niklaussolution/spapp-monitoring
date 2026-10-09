package com.spapp.monitoring.collectors

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * Fast, resilient on-demand location fetcher.
 * Triggered by an admin "Check Location Now" command.
 *
 * Implements a multi-tiered lookup strategy:
 * 1. Checks cached fixes (FusedLocationProvider + Native LocationManager).
 *    If fix is very fresh (< 30 seconds old), returns immediately (< 50ms response).
 * 2. Attempts fresh fix with a strict 3.5s timeout so the dashboard never hangs.
 * 3. Falls back to best cached fix if fresh acquisition times out.
 * 4. As a last resort (if cache was empty), attempts a short 3s high-accuracy fix.
 */
class LocationFetcher(private val context: Context) {

    companion object {
        private const val TAG = "LocationFetcher"
        private const val FRESH_CACHE_THRESHOLD_MS = 30_000L // 30 seconds
        private const val FRESH_FETCH_TIMEOUT_MS = 3_500L    // 3.5 seconds
    }

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** Returns null only if permission is missing or no fix could be obtained by any method. */
    suspend fun fetchCurrentLocation(): Location? {
        if (!hasPermission()) {
            Log.w(TAG, "Location permission not granted")
            return null
        }

        // 1. Check last known cached location first
        val lastKnown = fetchBestLastKnownLocation()
        if (lastKnown != null) {
            val ageMs = getLocationAgeMs(lastKnown)
            Log.d(TAG, "Best cached location found: age = ${ageMs}ms, accuracy = ${lastKnown.accuracy}m")
            // If cached location is very fresh (< 30s), return immediately!
            if (ageMs < FRESH_CACHE_THRESHOLD_MS) {
                Log.d(TAG, "Cached location is fresh (< 30s), returning immediately")
                return lastKnown
            }
        }

        // 2. Try to get a fresh fix with a strict timeout (3.5s) so the dashboard never times out
        val fresh = withTimeoutOrNull(FRESH_FETCH_TIMEOUT_MS) {
            fetchFreshLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY)
        }

        if (fresh != null) {
            Log.d(TAG, "Obtained fresh location: $fresh")
            return fresh
        }

        // 3. If fresh fix timed out or was null, fall back to last known location (even if older)
        if (lastKnown != null) {
            Log.d(TAG, "Fresh fetch timed out/null, falling back to cached location")
            return lastKnown
        }

        // 4. Last attempt: if we had no cached location at all, try high accuracy for 3 seconds
        return withTimeoutOrNull(3_000L) {
            fetchFreshLocation(Priority.PRIORITY_HIGH_ACCURACY)
        }
    }

    private fun getLocationAgeMs(location: Location): Long {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            val nanos = SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos
            (nanos / 1_000_000L).coerceAtLeast(0L)
        } else {
            (System.currentTimeMillis() - location.time).coerceAtLeast(0L)
        }
    }

    private suspend fun fetchBestLastKnownLocation(): Location? {
        val fused = fetchFusedLastLocation()
        val native = fetchNativeLastKnownLocation()

        return when {
            fused == null -> native
            native == null -> fused
            getLocationAgeMs(fused) <= getLocationAgeMs(native) -> fused
            else -> native
        }
    }

    private suspend fun fetchFusedLastLocation(): Location? {
        val client = LocationServices.getFusedLocationProviderClient(context)
        return suspendCancellableCoroutine { continuation ->
            try {
                client.lastLocation
                    .addOnSuccessListener { location ->
                        if (continuation.isActive) continuation.resume(location)
                    }
                    .addOnFailureListener { e ->
                        Log.e(TAG, "getLastLocation failed", e)
                        if (continuation.isActive) continuation.resume(null)
                    }
            } catch (e: SecurityException) {
                if (continuation.isActive) continuation.resume(null)
            } catch (e: Exception) {
                if (continuation.isActive) continuation.resume(null)
            }
        }
    }

    private fun fetchNativeLastKnownLocation(): Location? {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
        var best: Location? = null
        val providers = listOf(
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER,
            LocationManager.PASSIVE_PROVIDER
        )
        for (provider in providers) {
            try {
                if (lm.isProviderEnabled(provider)) {
                    val loc = lm.getLastKnownLocation(provider) ?: continue
                    if (best == null || getLocationAgeMs(loc) < getLocationAgeMs(best)) {
                        best = loc
                    }
                }
            } catch (e: Exception) {
                // Ignore provider errors or security exceptions
            }
        }
        return best
    }

    private suspend fun fetchFreshLocation(priority: Int): Location? {
        val client = LocationServices.getFusedLocationProviderClient(context)
        val cancellationSource = CancellationTokenSource()

        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { cancellationSource.cancel() }

            try {
                client.getCurrentLocation(priority, cancellationSource.token)
                    .addOnSuccessListener { location ->
                        Log.d(TAG, "getCurrentLocation success: $location")
                        if (continuation.isActive) continuation.resume(location)
                    }
                    .addOnFailureListener { e ->
                        Log.e(TAG, "getCurrentLocation failed", e)
                        if (continuation.isActive) continuation.resume(null)
                    }
            } catch (e: SecurityException) {
                Log.e(TAG, "getCurrentLocation SecurityException", e)
                if (continuation.isActive) continuation.resume(null)
            } catch (e: Exception) {
                if (continuation.isActive) continuation.resume(null)
            }
        }
    }
}
