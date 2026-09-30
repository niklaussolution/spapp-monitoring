package com.spapp.monitoring.fcm

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.spapp.monitoring.data.DeviceState
import com.spapp.monitoring.network.ApiClient
import com.spapp.monitoring.network.FcmTokenRequest

class FcmTokenUploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val authToken = DeviceState(applicationContext).authToken ?: return Result.failure()
        val fcmToken = inputData.getString(FcmTokenSync.KEY_TOKEN) ?: return Result.failure()

        return try {
            val response = ApiClient.service.updateFcmToken(
                "Bearer $authToken",
                FcmTokenRequest(fcmToken)
            )
            if (response.isSuccessful) Result.success() else Result.retry()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
