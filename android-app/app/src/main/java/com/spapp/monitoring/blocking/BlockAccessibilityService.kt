package com.spapp.monitoring.blocking

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.spapp.monitoring.data.DeviceState
import com.spapp.monitoring.data.local.AppDatabase
import com.spapp.monitoring.data.local.WebHistoryEntry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Enforces app_blocking rules (Phase 7) and, when web_history_tracking is
 * on, records the URLs it sees in a supported browser's address bar (Phase
 * 10 — see WebHistoryEntry). Only inspects two things, per the project's
 * transparency principles: (1) which app's window just came to the
 * foreground — the same information Android's own Digital Wellbeing/Family
 * Link use — and (2) the visible address-bar text of supported browsers.
 * It never reads message content, chat text, or any other on-screen
 * content. Both bullets are already listed in the on-device consent text
 * ("Website browsing history", "Device lock and file listing on request").
 *
 * WHY ACCESSIBILITY, NOT A CONTENT PROVIDER QUERY: modern Chrome exposes no
 * history API to third-party apps at all (removed from the public SDK years
 * ago) — there is no supported way to read it without this. Address-bar
 * inspection only works for browsers that expose a stable accessibility
 * resource-id for their URL bar, listed below; an unsupported or updated
 * browser simply won't be covered, for blocking or for history, while
 * app-level blocking (blocking a browser entirely) still works regardless.
 */
class BlockAccessibilityService : AccessibilityService() {

    private lateinit var rulesCache: BlockRulesCache
    private var lastBlockedPackage: String? = null
    private var lastBlockedAt = 0L
    private var lastRecordedUrl: String? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val browserUrlBarIds = setOf(
        "com.android.chrome:id/url_bar",
        "com.google.android.apps.chrome:id/url_bar",
        "com.brave.browser:id/url_bar",
        "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
        "com.microsoft.emmx:id/url_bar",
    )
    private val browserPackages = browserUrlBarIds.map { it.substringBefore(":id/") }.toSet()

    override fun onServiceConnected() {
        super.onServiceConnected()
        rulesCache = BlockRulesCache(applicationContext)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val packageName = event.packageName?.toString() ?: return
        if (packageName == applicationContext.packageName) return // never block ourselves

        // Web history recording is independent of block rules existing at
        // all — it used to live inside the "rules.isEmpty() return" guard
        // below, which meant no rules configured == no history ever
        // recorded, even with the feature flag on.
        if (packageName in browserPackages) {
            recordUrlIfEnabled(event, rootInActiveWindow)
        }

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

    // The omnibox shows one of these as hint text (not a real URL) on an
    // empty/new-tab address bar — without filtering these out, every visit
    // to a blank tab got logged as a fake "visit" to literally this phrase.
    private val addressBarHints = listOf(
        "search google or type url",
        "search google or type web address",
        "search or type url",
        "search or type web address",
    )

    private fun recordUrlIfEnabled(event: AccessibilityEvent, root: AccessibilityNodeInfo?) {
        if (!DeviceState(applicationContext).webHistoryTrackingEnabled) return
        val url = findUrlBarText(root) ?: return
        if (addressBarHints.any { url.trim().equals(it, ignoreCase = true) }) return // omnibox hint text, not a visit
        if (url == lastRecordedUrl) return // debounce — same URL re-fires on scroll/focus events
        lastRecordedUrl = url

        // Chrome reports the page's <title> as the window-state event's own
        // text (this is how the tab/window is announced to accessibility
        // services) — separate from the url_bar node, which only has the URL.
        val title = event.text?.firstOrNull()?.toString()?.takeIf { it.isNotBlank() }

        scope.launch {
            try {
                AppDatabase.getInstance(applicationContext).webHistoryDao().insert(
                    WebHistoryEntry(url = url, title = title, visitedAtEpochMs = System.currentTimeMillis())
                )
            } catch (e: Exception) {
                // Dropped — not worth retrying a single missed URL capture.
            }
        }
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
        // succession; avoid spamming Home actions and duplicate violation reports.
        val now = System.currentTimeMillis()
        if (matchedTarget == lastBlockedPackage && now - lastBlockedAt < 2000) return
        lastBlockedPackage = matchedTarget
        lastBlockedAt = now

        // NOT startActivity(ACTION_MAIN/CATEGORY_HOME) — Android's background
        // activity launch restrictions (tightened further on MIUI) silently
        // swallow a Context.startActivity() call made from a Service with no
        // visible UI of its own, so detection fired (the alert below proves
        // it) but nothing visibly happened. performGlobalAction is the
        // accessibility-specific API for this exact case — it simulates the
        // physical Home button press directly through the accessibility
        // layer, not through the activity-launch path, so it isn't subject
        // to that restriction.
        performGlobalAction(GLOBAL_ACTION_HOME)

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
