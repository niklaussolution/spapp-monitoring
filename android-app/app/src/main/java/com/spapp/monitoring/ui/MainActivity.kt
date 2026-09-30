package com.spapp.monitoring.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.google.firebase.messaging.FirebaseMessaging
import com.spapp.monitoring.BuildConfig
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

        // Debug/dev convenience only — production relies on the periodic
        // WorkManager schedule and FCM-triggered on-demand commands, not a
        // user-visible manual sync button.
        if (BuildConfig.DEBUG) {
            binding.btnSyncNow.setOnClickListener {
                SyncScheduler.runOnce(applicationContext)
            }
        } else {
            binding.btnSyncNow.visibility = android.view.View.GONE
        }
    }

    override fun onResume() {
        super.onResume()
        refreshPermissionButtons()
    }

    private fun uploadCurrentFcmToken() {
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            FcmTokenSync.enqueueUpload(applicationContext, token)
        }
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
    }
}
