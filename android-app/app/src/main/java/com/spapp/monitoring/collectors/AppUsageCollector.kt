package com.spapp.monitoring.collectors

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Process
import android.provider.Settings
import com.spapp.monitoring.data.local.AppUsageEntry
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Reads today's per-app foreground usage via UsageStatsManager. Requires the
 * PACKAGE_USAGE_STATS special access, which the user grants once in system
 * Settings (not a runtime permission dialog) — see hasUsageAccess().
 */
class AppUsageCollector(private val context: Context) {

    fun hasUsageAccess(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = appOps.unsafeCheckOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            context.packageName
        )
        return mode == AppOpsManager.MODE_ALLOWED
    }

    fun usageAccessSettingsIntent() = android.content.Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)

    /** Returns today's usage, one entry per app that had any foreground time. */
    fun collectToday(): List<AppUsageEntry> {
        if (!hasUsageAccess()) return emptyList()

        val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val calendar = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val startTime = calendar.timeInMillis
        val endTime = System.currentTimeMillis()

        val stats = usageStatsManager.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY, startTime, endTime
        ) ?: return emptyList()

        val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val today = dateFormat.format(calendar.time)
        val pm = context.packageManager

        return stats
            .filter { it.totalTimeInForeground > 0 }
            .map { stat ->
                AppUsageEntry(
                    packageName = stat.packageName,
                    appName = resolveAppName(pm, stat.packageName),
                    usageSeconds = stat.totalTimeInForeground / 1000,
                    usageDate = today
                )
            }
    }

    private fun resolveAppName(pm: PackageManager, packageName: String): String? = try {
        pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
        null
    }
}
