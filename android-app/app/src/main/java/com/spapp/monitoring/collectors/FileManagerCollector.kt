package com.spapp.monitoring.collectors

import android.content.Context
import com.spapp.monitoring.network.FileEntryDto
import java.io.File

/**
 * Lists files the admin can view via the dashboard's File Manager screen.
 *
 * IMPORTANT SCOPE LIMITATION: since Android 10's scoped storage, a
 * third-party app cannot browse arbitrary files elsewhere on the device
 * (other apps' private storage, or the shared storage root) without the
 * MANAGE_EXTERNAL_STORAGE special permission — which Google Play strictly
 * gates to file-manager/antivirus-category apps and would require a
 * separate policy justification. We deliberately do not request it.
 *
 * What this DOES list, without any special permission: files inside this
 * app's own private internal storage (context.filesDir) — fully sandboxed,
 * needs zero runtime permissions, and is where a "download a report to the
 * device" or "admin-pushed file" feature would live. This is an intentional
 * scope decision, not an oversight — see docs, section on File Manager.
 */
class FileManagerCollector(private val context: Context) {

    fun listFiles(relativePath: String? = null): List<FileEntryDto> = try {
        // context.filesDir can return a path through a /data/user/0/... symlink
        // while File.canonicalFile resolves to the real /data/data/... path —
        // canonicalize ONCE up front and use that same reference for both the
        // traversal check and relativeTo(), or the two diverge and every
        // "relative" path comes out as a garbled "../../../.." chain.
        // The whole function is wrapped — .canonicalFile can throw IOException
        // on some real-device storage states, and an uncaught exception here
        // previously crashed the entire SyncWorker run, leaving the command
        // stuck at "sent" forever (never acked, never failed).
        val root = context.filesDir.canonicalFile
        val target = if (relativePath.isNullOrBlank()) root else File(root, relativePath)
        val safeTarget = target.canonicalFile

        if (!safeTarget.path.startsWith(root.path)) {
            emptyList() // path traversal guard
        } else if (!safeTarget.exists() || !safeTarget.isDirectory) {
            emptyList()
        } else {
            safeTarget.listFiles()?.map { file ->
                FileEntryDto(
                    name = file.name,
                    path = file.canonicalFile.relativeTo(root).path,
                    isDirectory = file.isDirectory,
                    sizeBytes = if (file.isFile) file.length() else null,
                    mimeType = if (file.isFile) guessMimeType(file.extension) else null
                )
            }?.sortedWith(compareBy({ !it.isDirectory }, { it.name })) ?: emptyList()
        }
    } catch (e: Exception) {
        emptyList()
    }

    fun resolveFile(relativePath: String): File? = try {
        val root = context.filesDir.canonicalFile
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
        else -> null
    }
}
