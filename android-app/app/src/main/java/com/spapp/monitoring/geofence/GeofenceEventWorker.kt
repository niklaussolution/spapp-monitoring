package com.spapp.monitoring.geofence

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.spapp.monitoring.data.DeviceState
import com.spapp.monitoring.network.ApiClient
import com.spapp.monitoring.network.GeofenceEventRequest

/** Reports one geofence ENTER/EXIT transition to the backend. */
class GeofenceEventWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    companion object {
        const val KEY_GEOFENCE_ID = "geofence_id"
        const val KEY_TRANSITION = "transition"
        const val KEY_LATITUDE = "latitude"
        const val KEY_LONGITUDE = "longitude"
    }

    override suspend fun doWork(): Result {
        val authToken = DeviceState(applicationContext).authToken ?: return Result.failure()

        val geofenceId = inputData.getString(KEY_GEOFENCE_ID) ?: return Result.failure()
        val transition = inputData.getString(KEY_TRANSITION) ?: return Result.failure()
        val latitude = inputData.getDouble(KEY_LATITUDE, Double.NaN)
        val longitude = inputData.getDouble(KEY_LONGITUDE, Double.NaN)
        if (latitude.isNaN() || longitude.isNaN()) return Result.failure()

        return try {
            val response = ApiClient.service.reportGeofenceEvent(
                "Bearer $authToken",
                GeofenceEventRequest(geofenceId, transition, latitude, longitude)
            )
            if (response.isSuccessful) Result.success() else Result.retry()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
