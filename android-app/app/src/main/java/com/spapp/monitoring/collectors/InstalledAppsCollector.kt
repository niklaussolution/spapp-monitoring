package com.spapp.monitoring.collectors

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.util.Base64
import com.spapp.monitoring.data.local.InstalledAppEntry
import java.io.ByteArrayOutputStream

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
 *
 * Also captures each app's own launcher icon (downscaled to 48x48, PNG,
 * base64) so the dashboard can render a real icon grid instead of a bare
 * package-name list.
 */
class InstalledAppsCollector(private val context: Context) {

    companion object {
        private const val ICON_SIZE_PX = 48
    }

    fun collect(): List<InstalledAppEntry> {
        val pm = context.packageManager
        val packages = pm.getInstalledApplications(PackageManager.GET_META_DATA)

        return packages.map { app ->
            val installTime = try {
                pm.getPackageInfo(app.packageName, 0).firstInstallTime
            } catch (e: PackageManager.NameNotFoundException) {
                null
            }
            val icon = try {
                encodeIcon(pm.getApplicationIcon(app))
            } catch (e: Exception) {
                null
            }
            InstalledAppEntry(
                packageName = app.packageName,
                appName = pm.getApplicationLabel(app).toString(),
                installDateEpochMs = installTime,
                iconBase64 = icon
            )
        }
    }

    private fun encodeIcon(drawable: Drawable): String? {
        val bitmap = drawableToBitmap(drawable) ?: return null
        val scaled = Bitmap.createScaledBitmap(bitmap, ICON_SIZE_PX, ICON_SIZE_PX, true)
        val stream = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.PNG, 90, stream)
        return Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
    }

    private fun drawableToBitmap(drawable: Drawable): Bitmap? {
        if (drawable is BitmapDrawable && drawable.bitmap != null) return drawable.bitmap

        val width = drawable.intrinsicWidth.takeIf { it > 0 } ?: ICON_SIZE_PX
        val height = drawable.intrinsicHeight.takeIf { it > 0 } ?: ICON_SIZE_PX
        return try {
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            drawable.setBounds(0, 0, canvas.width, canvas.height)
            drawable.draw(canvas)
            bitmap
        } catch (e: Exception) {
            null
        }
    }
}
