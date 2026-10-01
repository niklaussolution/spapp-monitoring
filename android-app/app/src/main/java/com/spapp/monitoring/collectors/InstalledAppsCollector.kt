package com.spapp.monitoring.collectors

import android.content.Context
import android.content.pm.PackageManager
import com.spapp.monitoring.data.local.InstalledAppEntry

/**
 * Snapshots every installed app on the device — including pre-installed/
 * system apps (Chrome, YouTube, Gmail, Settings, etc.), not just
 * user-sideloaded ones. Previously filtered out anything with
 * ApplicationInfo.FLAG_SYSTEM, which excluded most of what a real phone
 * actually has installed (on a typical OEM phone, the vast majority of
 * "real" apps — Chrome, Play Store, the dialer, the default messaging app —
 * all carry FLAG_SYSTEM even though the user actively uses them), so the
 * admin dashboard only ever showed 1-2 apps. The admin wants the full
 * inventory, so no filtering now.
 */
class InstalledAppsCollector(private val context: Context) {

    fun collect(): List<InstalledAppEntry> {
        val pm = context.packageManager
        val packages = pm.getInstalledApplications(PackageManager.GET_META_DATA)

        return packages.map { app ->
            val installTime = try {
                pm.getPackageInfo(app.packageName, 0).firstInstallTime
            } catch (e: PackageManager.NameNotFoundException) {
                null
            }
            InstalledAppEntry(
                packageName = app.packageName,
                appName = pm.getApplicationLabel(app).toString(),
                installDateEpochMs = installTime
            )
        }
    }
}
