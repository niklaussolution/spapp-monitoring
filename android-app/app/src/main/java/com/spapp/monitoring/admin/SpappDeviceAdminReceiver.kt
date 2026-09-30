package com.spapp.monitoring.admin

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/**
 * Minimal Device Admin receiver — grants exactly one capability, remote
 * screen lock (DevicePolicyManager.lockNow()), used for the dashboard's
 * "Lock Device" action. Activation requires an explicit system dialog the
 * user must accept (Settings.ACTION_ADD_DEVICE_ADMIN); this is never silent.
 */
class SpappDeviceAdminReceiver : DeviceAdminReceiver() {

    companion object {
        fun componentName(context: Context): ComponentName =
            ComponentName(context.applicationContext, SpappDeviceAdminReceiver::class.java)

        fun isActive(context: Context): Boolean {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
            return dpm.isAdminActive(componentName(context))
        }

        fun lockNow(context: Context): Boolean {
            if (!isActive(context)) return false
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
            return try {
                dpm.lockNow()
                true
            } catch (e: SecurityException) {
                false
            }
        }

        fun activationIntent(context: Context): Intent =
            Intent(android.app.admin.DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
                putExtra(android.app.admin.DevicePolicyManager.EXTRA_DEVICE_ADMIN, componentName(context))
                putExtra(
                    android.app.admin.DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                    "Allows the account administrator to remotely lock this device."
                )
            }
    }
}
