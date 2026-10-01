package com.spapp.monitoring.ui

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.google.firebase.messaging.FirebaseMessaging
import com.spapp.monitoring.admin.SpappDeviceAdminReceiver
import com.spapp.monitoring.blocking.AccessibilityStatus
import com.spapp.monitoring.collectors.AppUsageCollector
import com.spapp.monitoring.databinding.ActivityMainBinding
import com.spapp.monitoring.fcm.FcmTokenSync
import com.spapp.monitoring.geofence.GeofenceManager
import com.spapp.monitoring.sync.SyncScheduler

/**
 * Status screen shown after the device is activated. Kicks off the periodic
 * background sync (Phase 4/5) and offers the special-access grants that
 * can't be requested as part of the initial consent-flow permission batch:
 * Usage Access and Background Location (see Phase 3/5), plus Device Admin
 * activation for Remote Lock (Phase 6) — all of these require their own
 * explicit system dialog, never silent.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var usageCollector: AppUsageCollector
    private lateinit var geofenceManager: GeofenceManager

    private val backgroundLocationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { refreshPermissionButtons() }

    private val deviceAdminLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { refreshPermissionButtons() }

    private val batteryExemptionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { refreshPermissionButtons() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        usageCollector = AppUsageCollector(this)
        geofenceManager = GeofenceManager(this)

        SyncScheduler.schedule(applicationContext)
        uploadCurrentFcmToken()

        binding.btnGrantUsageAccess.setOnClickListener {
            startActivity(usageCollector.usageAccessSettingsIntent())
        }

        binding.btnGrantBackgroundLocation.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                backgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            }
        }

        binding.btnEnableRemoteLock.setOnClickListener {
            deviceAdminLauncher.launch(SpappDeviceAdminReceiver.activationIntent(this))
        }

        binding.btnEnableAppBlocking.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        binding.btnGrantFileAccess.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            }
        }

        binding.btnGrantBatteryExemption.setOnClickListener {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            batteryExemptionLauncher.launch(intent)
        }

        binding.btnGrantAutostart.setOnClickListener {
            openAutostartSettings()
        }

        // Kept available in every build, not just debug — on OEM ROMs (MIUI in
        // particular) the periodic WorkManager schedule and FCM pushes are both
        // unreliable in the background even with battery exemption granted, so
        // the admin/user needs a manual way to force an immediate sync.
        binding.btnSyncNow.setOnClickListener {
            SyncScheduler.runOnce(applicationContext)
        }
    }

    /**
     * MIUI (and several other OEM ROMs) silently kill WorkManager jobs in the
     * background unless the app is also allowlisted in the vendor's own
     * "Autostart"/"Auto-launch" screen — there is no standard Android API for
     * this, only vendor-specific activities that may not exist on a given ROM
     * build, so every attempt is wrapped and falls back to the generic
     * app-info screen instead of crashing or doing nothing.
     */
    private fun openAutostartSettings() {
        val candidates = listOf(
            Intent().setComponent(
                ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")
            ),
            Intent().setComponent(
                ComponentName("com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity")
            ),
            Intent().setComponent(
                ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")
            ),
            Intent().setComponent(
                ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")
            ),
            Intent().setComponent(
                ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")
            ),
        )
        for (intent in candidates) {
            try {
                startActivity(intent)
                return
            } catch (e: Exception) {
                // Not this OEM/ROM — try the next, then fall back below.
            }
        }
        try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        } catch (e: Exception) {
            Log.e(TAG, "No autostart or app-info settings screen available", e)
        }
    }

    override fun onResume() {
        super.onResume()
        refreshPermissionButtons()
    }

    private fun uploadCurrentFcmToken() {
        // Previously had no failure handling or logging at all — if Play
        // Services wasn't ready yet (common on first launch, and on some
        // OEM ROMs like MIUI where Play Services init is delayed/throttled),
        // this failed completely silently and the device never got an FCM
        // token registered, permanently falling back to poll-only delivery.
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token ->
                Log.d(TAG, "FCM token fetched: $token")
                FcmTokenSync.enqueueUpload(applicationContext, token)
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "FCM token fetch failed", e)
            }
    }

    companion object {
        private const val TAG = "MainActivity"
    }

    private fun refreshPermissionButtons() {
        binding.btnGrantUsageAccess.visibility =
            if (usageCollector.hasUsageAccess()) android.view.View.GONE else android.view.View.VISIBLE

        // Only relevant on Android 10+; below that, fine location alone covers geofencing.
        val needsBackgroundLocation = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !geofenceManager.hasPermission()
        binding.btnGrantBackgroundLocation.visibility =
            if (needsBackgroundLocation) android.view.View.VISIBLE else android.view.View.GONE

        binding.btnEnableRemoteLock.visibility =
            if (SpappDeviceAdminReceiver.isActive(this)) android.view.View.GONE else android.view.View.VISIBLE

        binding.btnEnableAppBlocking.visibility =
            if (AccessibilityStatus.isEnabled(this)) android.view.View.GONE else android.view.View.VISIBLE

        val hasFullFileAccess = Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager()
        binding.btnGrantFileAccess.visibility =
            if (hasFullFileAccess) android.view.View.GONE else android.view.View.VISIBLE

        val powerManager = getSystemService(POWER_SERVICE) as PowerManager
        val hasBatteryExemption = powerManager.isIgnoringBatteryOptimizations(packageName)
        binding.btnGrantBatteryExemption.visibility =
            if (hasBatteryExemption) android.view.View.GONE else android.view.View.VISIBLE

        // No public API to check autostart allowlist status on any OEM, so this
        // stays visible whenever battery exemption also still needs granting —
        // on MIUI the two are usually set together during initial setup.
        binding.btnGrantAutostart.visibility =
            if (hasBatteryExemption) android.view.View.GONE else android.view.View.VISIBLE
    }
}
