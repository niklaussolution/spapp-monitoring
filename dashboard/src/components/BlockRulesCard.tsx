import { useEffect, useRef, useState } from "react";
import { devicesApi } from "../api/devices";
import type { BlockRule, InstalledApp } from "../api/types";
import ToggleSwitch from "./ToggleSwitch";

export default function BlockRulesCard({ deviceId }: { deviceId: string }) {
  const [rules, setRules] = useState<BlockRule[]>([]);
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [ruleType, setRuleType] = useState<"app" | "website">("app");
  const [target, setTarget] = useState(""); // package name (app) or domain (website)
  const [appQuery, setAppQuery] = useState(""); // search text shown in the app picker input
  const [appPickerOpen, setAppPickerOpen] = useState(false);

  // "pending" = rule saved, waiting for the device's next sync to pick it up.
  // "confirmed" = the device has synced at least once since — shown as a
  // checkmark for a few seconds, then cleared. Same pattern as FeatureFlagsCard.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const pollTimers = useRef<Record<string, number>>({});
  // Rules deleted on the backend already, but kept visible (greyed out,
  // controls disabled) until the device confirms it's synced since the
  // delete — removed from view only then, not the instant the API call returns.
  const [removing, setRemoving] = useState<Set<string>>(new Set());

  function load() {
    devicesApi.listBlockRules(deviceId).then(setRules);
  }

  useEffect(load, [deviceId]);
  useEffect(() => {
    devicesApi.installedApps(deviceId).then(setApps);
  }, [deviceId]);

  const filteredApps =
    appQuery.trim().length === 0
      ? apps.slice(0, 50)
      : apps
          .filter((a) => (a.app_name || a.package_name).toLowerCase().includes(appQuery.toLowerCase()))
          .slice(0, 50);

  function selectApp(app: InstalledApp) {
    setTarget(app.package_name);
    setAppQuery(app.app_name || app.package_name);
    setAppPickerOpen(false);
  }

  function resetForm() {
    setTarget("");
    setAppQuery("");
    setShowForm(false);
    setAppPickerOpen(false);
  }

  async function handleCreate() {
    if (!target.trim()) return;
    const rule = await devicesApi.createBlockRule(deviceId, { ruleType, target: target.trim() });
    resetForm();
    load();
    confirmDeviceSync(rule.id);
  }

  async function toggleActive(rule: BlockRule) {
    await devicesApi.updateBlockRule(deviceId, rule.id, { active: !rule.active });
    load();
    confirmDeviceSync(rule.id);
  }

  /**
   * The rule is gone from the backend the moment this call returns — the
   * device's next sync simply won't include it anymore, there's no "undo
   * the delete" to ack. But staying visible until the device has actually
   * had a chance to sync (not just "we told the server") is what the admin
   * asked for: don't let the dashboard claim a block is lifted before the
   * target device could possibly know that yet.
   */
  async function handleDelete(rule: BlockRule) {
    setRemoving((s) => new Set(s).add(rule.id));
    await devicesApi.deleteBlockRule(deviceId, rule.id);
    confirmDeviceSync(rule.id, { onConfirmed: () => removeFromView(rule.id) });
  }

  function removeFromView(ruleId: string) {
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
    setRemoving((s) => {
      const next = new Set(s);
      next.delete(ruleId);
      return next;
    });
  }

  /**
   * Polls device.block_rules_synced_at specifically — NOT last_seen_at.
   * last_seen_at advances on almost any successful sync call (feature-flags
   * is fetched first in each pass and rarely fails), so it doesn't actually
   * prove the device re-fetched its block rules; it could look "confirmed"
   * from an unrelated call succeeding while the rule list the device is
   * actually enforcing is still stale. block_rules_synced_at is touched
   * only by GET /api/sync/block-rules, so it's a real guarantee.
   */
  function confirmDeviceSync(ruleId: string, opts?: { onConfirmed?: () => void }) {
    setPending((s) => new Set(s).add(ruleId));
    setConfirmed((s) => {
      const next = new Set(s);
      next.delete(ruleId);
      return next;
    });

    const changedAt = Date.now();
    let attempts = 0;

    const poll = async () => {
      attempts++;
      try {
        const device = await devicesApi.get(deviceId);
        const rulesSyncedAt = device.block_rules_synced_at
          ? new Date(device.block_rules_synced_at).getTime()
          : 0;
        if (rulesSyncedAt > changedAt) {
          setPending((s) => {
            const next = new Set(s);
            next.delete(ruleId);
            return next;
          });
          if (opts?.onConfirmed) {
            opts.onConfirmed();
            return;
          }
          setConfirmed((s) => new Set(s).add(ruleId));
          window.setTimeout(() => {
            setConfirmed((s) => {
              const next = new Set(s);
              next.delete(ruleId);
              return next;
            });
          }, 5000);
          return;
        }
      } catch {
        // Keep polling — a transient network error shouldn't stop the attempt count.
      }

      if (attempts < 8) {
        pollTimers.current[ruleId] = window.setTimeout(poll, 4000);
      } else {
        setPending((s) => {
          const next = new Set(s);
          next.delete(ruleId);
          return next;
        });
        // Give up waiting for confirmation, but the rule really is gone
        // server-side by now — don't leave a dead row behind forever.
        opts?.onConfirmed?.();
      }
    };

    window.clearTimeout(pollTimers.current[ruleId]);
    pollTimers.current[ruleId] = window.setTimeout(poll, 4000);
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-sm">Block Rules</h2>
        <button onClick={() => (showForm ? resetForm() : setShowForm(true))} className="text-xs text-accent hover:underline">
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-50 rounded p-3 mb-3 space-y-2">
          <select
            value={ruleType}
            onChange={(e) => {
              setRuleType(e.target.value as "app" | "website");
              setTarget("");
              setAppQuery("");
            }}
            className="w-full border rounded px-2 py-1.5 text-xs"
          >
            <option value="app">App</option>
            <option value="website">Website (domain)</option>
          </select>

          {ruleType === "app" ? (
            <div className="relative">
              <input
                placeholder="Search installed apps..."
                value={appQuery}
                onChange={(e) => {
                  setAppQuery(e.target.value);
                  setTarget("");
                  setAppPickerOpen(true);
                }}
                onFocus={() => setAppPickerOpen(true)}
                onBlur={() => window.setTimeout(() => setAppPickerOpen(false), 150)}
                className="w-full border rounded px-2 py-1.5 text-xs"
              />
              {appPickerOpen && (
                <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white border rounded shadow-lg">
                  {filteredApps.length === 0 ? (
                    <p className="text-xs text-gray-400 px-2 py-2">No matching apps synced yet.</p>
                  ) : (
                    filteredApps.map((a) => (
                      <button
                        key={a.package_name}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()} // keep input focus so onBlur doesn't fire first
                        onClick={() => selectApp(a)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-gray-50"
                      >
                        {a.icon_base64 ? (
                          <img src={`data:image/png;base64,${a.icon_base64}`} alt="" className="w-5 h-5 rounded flex-shrink-0" />
                        ) : (
                          <div className="w-5 h-5 rounded bg-gray-100 flex-shrink-0" />
                        )}
                        <span className="truncate">{a.app_name || a.package_name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <input
              placeholder="e.g. instagram.com"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-xs font-mono"
            />
          )}

          <button
            onClick={handleCreate}
            disabled={!target.trim()}
            className="bg-primary text-white text-xs px-3 py-1.5 rounded hover:bg-primary-dark disabled:opacity-50"
          >
            Create (always-on — scheduling coming soon)
          </button>
        </div>
      )}

      {rules.length === 0 ? (
        <p className="text-xs text-gray-400">No block rules.</p>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => {
            const app = apps.find((a) => a.package_name === r.target);
            const isRemoving = removing.has(r.id);
            return (
              <div
                key={r.id}
                className={`flex justify-between items-center text-xs border-b pb-2 last:border-0 ${
                  isRemoving ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  {r.rule_type === "app" && app?.icon_base64 && (
                    <img src={`data:image/png;base64,${app.icon_base64}`} alt="" className="w-5 h-5 rounded" />
                  )}
                  <span className="uppercase text-gray-400">{r.rule_type}</span>
                  <span className="font-mono">{app?.app_name || r.target}</span>
                  {isRemoving && (
                    <span className="text-gray-400" title="Waiting for the device to confirm removal...">
                      Removing... ⏳
                    </span>
                  )}
                  {!isRemoving && pending.has(r.id) && (
                    <span className="text-gray-300" title="Waiting for the device to sync...">
                      ⏳
                    </span>
                  )}
                  {!isRemoving && confirmed.has(r.id) && (
                    <span className="text-green-600" title="Device has synced since this change">
                      ✓
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <ToggleSwitch checked={r.active} onChange={() => toggleActive(r)} disabled={isRemoving} />
                  <button
                    onClick={() => handleDelete(r)}
                    disabled={isRemoving}
                    className="text-red-500 hover:underline disabled:opacity-50 disabled:cursor-wait"
                  >
                    {isRemoving ? "..." : "Remove"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
