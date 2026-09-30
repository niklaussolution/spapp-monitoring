package com.spapp.monitoring.blocking

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.spapp.monitoring.data.DeviceState
import com.spapp.monitoring.network.ApiClient
import com.spapp.monitoring.network.BlockViolationRequest

/** Reports one block attempt to the backend (raises a dashboard alert). */
class BlockViolationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    companion object {
        private const val KEY_RULE_ID = "rule_id"
        private const val KEY_TARGET = "target"

        fun enqueue(context: Context, ruleId: String, target: String) {
            val data = Data.Builder()
                .putString(KEY_RULE_ID, ruleId)
                .putString(KEY_TARGET, target)
                .build()
            val request = OneTimeWorkRequestBuilder<BlockViolationWorker>().setInputData(data).build()
            WorkManager.getInstance(context).enqueue(request)
        }
    }

    override suspend fun doWork(): Result {
        val authToken = DeviceState(applicationContext).authToken ?: return Result.failure()
        val ruleId = inputData.getString(KEY_RULE_ID) ?: return Result.failure()
        val target = inputData.getString(KEY_TARGET) ?: return Result.failure()

        return try {
            val response = ApiClient.service.reportBlockViolation(
                "Bearer $authToken",
                BlockViolationRequest(ruleId, target)
            )
            if (response.isSuccessful) Result.success() else Result.retry()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
