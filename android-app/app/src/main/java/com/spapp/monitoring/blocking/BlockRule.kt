package com.spapp.monitoring.blocking

/** Local representation of a synced block rule, plus schedule matching. */
data class BlockRule(
    val id: String,
    val ruleType: String,   // "app" | "website"
    val target: String,     // package name or domain fragment
    val days: List<String>?,   // e.g. ["mon","tue"] — null/empty = every day
    val startTime: String?,    // "HH:mm" — null = no time restriction (always active)
    val endTime: String?
) {
    /** True if this rule is currently in its restricted window (or has no schedule at all). */
    fun isActiveNow(nowDayAbbrev: String, nowMinutesOfDay: Int): Boolean {
        if (days.isNullOrEmpty() && startTime.isNullOrEmpty()) return true // always-on rule

        if (!days.isNullOrEmpty() && nowDayAbbrev !in days) return false

        if (startTime.isNullOrEmpty() || endTime.isNullOrEmpty()) return true

        val start = parseMinutes(startTime)
        val end = parseMinutes(endTime)
        return if (start <= end) {
            nowMinutesOfDay in start..end
        } else {
            // overnight window, e.g. 22:00-06:00
            nowMinutesOfDay >= start || nowMinutesOfDay <= end
        }
    }

    private fun parseMinutes(hhmm: String): Int {
        val parts = hhmm.split(":")
        val h = parts.getOrNull(0)?.toIntOrNull() ?: 0
        val m = parts.getOrNull(1)?.toIntOrNull() ?: 0
        return h * 60 + m
    }
}
