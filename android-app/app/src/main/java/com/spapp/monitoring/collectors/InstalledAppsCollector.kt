package com.spapp.monitoring.collectors

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import com.spapp.monitoring.data.local.InstalledAppEntry

/** Snapshots the currently installed, user-facing (non-system) apps. */
class InstalledAppsCollector(private val context: Context) {

    fun collect(): List<InstalledAppEntry> {
        val pm = context.packageManager
        val packages = pm.getInstalledApplications(PackageManager.GET_META_DATA)

        return packages
            .filter { (it.flags and ApplicationInfo.FLAG_SYSTEM) == 0 } // skip pre-installed system apps
            .map { app ->
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
