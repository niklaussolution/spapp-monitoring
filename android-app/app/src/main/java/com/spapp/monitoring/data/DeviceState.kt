package com.spapp.monitoring.data

import android.content.Context
import androidx.core.content.edit

/**
 * Small key-value store for device activation state: whether consent was
 * given, and the device auth token returned by POST /api/devices/activate.
 * Deliberately not Room — this is a handful of scalar flags read on every
 * app start, not log data (log storage is handled by AppDatabase, Phase 4).
 */
class DeviceState(context: Context) {
    private val prefs = context.getSharedPreferences("device_state", Context.MODE_PRIVATE)

    var consentGiven: Boolean
        get() = prefs.getBoolean(KEY_CONSENT_GIVEN, false)
        set(value) = prefs.edit { putBoolean(KEY_CONSENT_GIVEN, value) }

    var authToken: String?
        get() = prefs.getString(KEY_AUTH_TOKEN, null)
        set(value) = prefs.edit { putString(KEY_AUTH_TOKEN, value) }

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        set(value) = prefs.edit { putString(KEY_DEVICE_ID, value) }

    val isActivated: Boolean
        get() = consentGiven && !authToken.isNullOrEmpty()

    companion object {
        private const val KEY_CONSENT_GIVEN = "consent_given"
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_DEVICE_ID = "device_id"
    }
}
