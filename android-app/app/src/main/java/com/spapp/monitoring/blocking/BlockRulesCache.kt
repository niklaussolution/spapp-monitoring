package com.spapp.monitoring.blocking

import android.content.Context
import androidx.core.content.edit
import org.json.JSONArray
import org.json.JSONObject

/**
 * Local cache of the last-synced block rules, so the AccessibilityService
 * can check every foreground-app change instantly without a network call.
 * Refreshed by SyncWorker each periodic sync.
 */
class BlockRulesCache(context: Context) {
    private val prefs = context.getSharedPreferences("block_rules_cache", Context.MODE_PRIVATE)

    fun save(rules: List<BlockRule>) {
        val arr = JSONArray()
        rules.forEach { rule ->
            arr.put(JSONObject().apply {
                put("id", rule.id)
                put("ruleType", rule.ruleType)
                put("target", rule.target)
                put("days", rule.days?.let { JSONArray(it) })
                put("startTime", rule.startTime)
                put("endTime", rule.endTime)
            })
        }
        prefs.edit { putString(KEY_RULES, arr.toString()) }
    }

    fun load(): List<BlockRule> {
        val json = prefs.getString(KEY_RULES, null) ?: return emptyList()
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                val daysArr = obj.optJSONArray("days")
                BlockRule(
                    id = obj.getString("id"),
                    ruleType = obj.getString("ruleType"),
                    target = obj.getString("target"),
                    days = daysArr?.let { d -> (0 until d.length()).map { d.getString(it) } },
                    startTime = if (obj.isNull("startTime")) null else obj.optString("startTime"),
                    endTime = if (obj.isNull("endTime")) null else obj.optString("endTime")
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    companion object {
        private const val KEY_RULES = "rules_json"
    }
}
