package com.spapp.monitoring.blocking

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Enforces app_blocking rules (Phase 7). Only inspects two things, per the
 * project's transparency principles: (1) which app's window just came to
 * the foreground — the same information Android's own Digital Wellbeing/
 * Family Link use — and (2), for app-level website rules, the visible
 * address-bar text of supported browsers. It never reads message content,
 * chat text, or any other on-screen content.
 *
 * WEBSITE BLOCKING LIMITATION (documented, not an oversight — see
 * WebHistoryCollector for the same pattern): address-bar inspection only
 * works for browsers that expose a stable accessibility resource-id for
 * their URL bar. Chrome and a few others are supported below; an
 * unsupported or updated browser simply won't be blockable by domain,
 * while app-level blocking (blocking a browser entirely) still works
 * regardless.
 */
class BlockAccessibilityService : AccessibilityService() {

    private lateinit var rulesCache: BlockRulesCache
    private var lastBlockedPackage: String? = null
    private var lastBlockedAt = 0L

    private val browserUrlBarIds = setOf(
        "com.android.chrome:id/url_bar",
        "com.google.android.apps.chrome:id/url_bar",
        "com.brave.browser:id/url_bar",
        "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
        "com.microsoft.emmx:id/url_bar",
    )

    override fun onServiceConnected() {
        super.onServiceConnected()
        rulesCache = BlockRulesCache(applicationContext)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val packageName = event.packageName?.toString() ?: return
        if (packageName == applicationContext.packageName) return // never block ourselves

        if (!::rulesCache.isInitialized) rulesCache = BlockRulesCache(applicationContext)
        val rules = rulesCache.load()
        if (rules.isEmpty()) return

        val (dayAbbrev, minutesOfDay) = currentDayAndMinute()

        // App-level rule for the foreground app itself.
        rules.firstOrNull { it.ruleType == "app" && it.target == packageName }
            ?.let { rule ->
                if (rule.isActiveNow(dayAbbrev, minutesOfDay)) {
                    blockForeground(rule, packageName)
                    return
                }
            }

        // Website rules — only checked if this foreground app is a known browser.
        val websiteRules = rules.filter { it.ruleType == "website" }
        if (websiteRules.isEmpty()) return

        val urlBarText = findUrlBarText(rootInActiveWindow) ?: return
        websiteRules.firstOrNull { rule ->
            rule.isActiveNow(dayAbbrev, minutesOfDay) && urlBarText.contains(rule.target, ignoreCase = true)
        }?.let { rule -> blockForeground(rule, urlBarText) }
    }

    private fun findUrlBarText(root: AccessibilityNodeInfo?): String? {
        if (root == null) return null
        for (resourceId in browserUrlBarIds) {
            val nodes = root.findAccessibilityNodeInfosByViewId(resourceId)
            val text = nodes?.firstOrNull()?.text?.toString()
            if (!text.isNullOrBlank()) return text
        }
        return null
    }

    private fun blockForeground(rule: BlockRule, matchedTarget: String) {
        // Debounce — one window-state event can fire multiple times in quick
        // succession; avoid spamming Home intents and duplicate violation reports.
        val now = System.currentTimeMillis()
        if (matchedTarget == lastBlockedPackage && now - lastBlockedAt < 2000) return
        lastBlockedPackage = matchedTarget
        lastBlockedAt = now

        val home = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(home)

        BlockViolationWorker.enqueue(applicationContext, rule.id, matchedTarget)
    }

    private fun currentDayAndMinute(): Pair<String, Int> {
        val cal = Calendar.getInstance()
        val dayAbbrev = SimpleDateFormat("EEE", Locale.US).format(cal.time).lowercase()
        val minutesOfDay = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        return dayAbbrev to minutesOfDay
    }

    override fun onInterrupt() {}
}
