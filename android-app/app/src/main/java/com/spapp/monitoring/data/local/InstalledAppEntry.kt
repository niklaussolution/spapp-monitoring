package com.spapp.monitoring.data.local

/**
 * Plain transport model — NOT a Room entity. Installed apps are a point-in-time
 * snapshot (not an append-only log), so the collector re-reads PackageManager
 * and uploads directly each sync run; the backend does a full upsert.
 */
data class InstalledAppEntry(
    val packageName: String,
    val appName: String?,
    val installDateEpochMs: Long?,
    /** Small (48x48) PNG icon, base64-encoded — null if it couldn't be rendered. */
    val iconBase64: String?
)
