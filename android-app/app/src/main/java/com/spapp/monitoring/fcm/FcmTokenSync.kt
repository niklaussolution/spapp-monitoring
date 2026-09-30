package com.spapp.monitoring.fcm

import android.content.Context
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager

object FcmTokenSync {
    const val KEY_TOKEN = "fcm_token"

    fun enqueueUpload(context: Context, token: String) {
        val request = OneTimeWorkRequestBuilder<FcmTokenUploadWorker>()
            .setInputData(Data.Builder().putString(KEY_TOKEN, token).build())
            .build()
        WorkManager.getInstance(context).enqueue(request)
    }
}
