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

  async function handleDelete(id: string) {
    await devicesApi.deleteBlockRule(deviceId, id);
    load();
  }

  /**
   * Same "has the device actually synced since this change" signal as
   * FeatureFlagsCard — a block rule isn't a command the device acks, it's
   * just picked up on the next sync, so creating or toggling one used to
   * look identical on the dashboard whether the device had it yet or not.
   */
  function confirmDeviceSync(ruleId: string) {
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
        const lastSeen = device.last_seen_at ? new Date(device.last_seen_at).getTime() : 0;
        if (lastSeen > changedAt) {
          setPending((s) => {
            const next = new Set(s);
            next.delete(ruleId);
            return next;
          });
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
            return (
              <div key={r.id} className="flex justify-between items-center text-xs border-b pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  {r.rule_type === "app" && app?.icon_base64 && (
                    <img src={`data:image/png;base64,${app.icon_base64}`} alt="" className="w-5 h-5 rounded" />
                  )}
                  <span className="uppercase text-gray-400">{r.rule_type}</span>
                  <span className="font-mono">{app?.app_name || r.target}</span>
                  {pending.has(r.id) && (
                    <span className="text-gray-300" title="Waiting for the device to sync...">
                      ⏳
                    </span>
                  )}
                  {confirmed.has(r.id) && (
                    <span className="text-green-600" title="Device has synced since this change">
                      ✓
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <ToggleSwitch checked={r.active} onChange={() => toggleActive(r)} />
                  <button onClick={() => handleDelete(r.id)} className="text-red-500 hover:underline">
                    Remove
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
