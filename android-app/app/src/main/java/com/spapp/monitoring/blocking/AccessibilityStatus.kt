package com.spapp.monitoring.blocking

import android.content.Context
import android.provider.Settings
import android.text.TextUtils

object AccessibilityStatus {
    /** True if the user has manually enabled BlockAccessibilityService in system Settings. */
    fun isEnabled(context: Context): Boolean {
        val expectedComponent = "${context.packageName}/${BlockAccessibilityService::class.java.name}"
        val enabledServices = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false

        return enabledServices.split(":").any { TextUtils.equals(it, expectedComponent) }
    }
}
