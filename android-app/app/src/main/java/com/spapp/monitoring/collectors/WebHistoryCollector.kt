package com.spapp.monitoring.collectors

import android.content.Context
import android.net.Uri

/**
 * Best-effort website history collection.
 *
 * IMPORTANT LIMITATION: modern Chrome (the default browser on most Android
 * devices) does not expose a history content provider to third-party apps —
 * this has been the case since Chrome dropped support for
 * android.provider.Browser's shared history table years ago. Without root,
 * there is no supported Android API for a third-party app to read another
 * app's (Chrome's) browsing history.
 *
 * This collector only works against browsers that still implement the
 * legacy android.provider.Browser.BOOKMARKS_URI-compatible history provider
 * (some OEM/legacy browsers). On a stock Chrome-only device, this returns an
 * empty list every time — that is expected, not a bug. web_history_tracking
 * should be treated as "best effort, browser-dependent" in the dashboard UI,
 * not a guaranteed feature, until/unless a different approach (e.g. a
 * companion browser extension) is scoped separately.
 */
class WebHistoryCollector(private val context: Context) {

    data class Entry(val url: String, val title: String?, val visitedAtEpochMs: Long)

    fun collectRecent(limitCount: Int = 200): List<Entry> {
        val entries = mutableListOf<Entry>()
        val legacyHistoryUri = Uri.parse("content://browser/history")
        // Raw column names — android.provider.Browser.BookmarkColumns was removed from the
        // public SDK; these providers (where they still exist on some OEM/legacy browsers)
        // still use this historical schema.
        val colUrl = "url"
        val colTitle = "title"
        val colDate = "date"

        try {
            context.contentResolver.query(
                legacyHistoryUri,
                arrayOf(colUrl, colTitle, colDate),
                null,
                null,
                "$colDate DESC"
            )?.use { cursor ->
                // Not every provider accepts a "LIMIT" token in the sortOrder string — cap in-memory.
                val urlIdx = cursor.getColumnIndex(colUrl)
                val titleIdx = cursor.getColumnIndex(colTitle)
                val dateIdx = cursor.getColumnIndex(colDate)
                while (cursor.moveToNext() && entries.size < limitCount) {
                    entries += Entry(
                        url = cursor.getString(urlIdx) ?: continue,
                        title = if (titleIdx >= 0) cursor.getString(titleIdx) else null,
                        visitedAtEpochMs = if (dateIdx >= 0) cursor.getLong(dateIdx) else System.currentTimeMillis()
                    )
                }
            }
        } catch (e: SecurityException) {
            // No access — expected on modern Chrome-only devices.
        } catch (e: Exception) {
            // Provider not present on this device — expected, not fatal.
        }

        return entries
    }
}
