import { useEffect, useState } from "react";
import { devicesApi } from "../api/devices";
import type { BlockRule } from "../api/types";

export default function BlockRulesCard({ deviceId }: { deviceId: string }) {
  const [rules, setRules] = useState<BlockRule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [ruleType, setRuleType] = useState<"app" | "website">("app");
  const [target, setTarget] = useState("");

  function load() {
    devicesApi.listBlockRules(deviceId).then(setRules);
  }

  useEffect(load, [deviceId]);

  async function handleCreate() {
    if (!target.trim()) return;
    await devicesApi.createBlockRule(deviceId, { ruleType, target: target.trim() });
    setTarget("");
    setShowForm(false);
    load();
  }

  async function toggleActive(rule: BlockRule) {
    await devicesApi.updateBlockRule(deviceId, rule.id, { active: !rule.active });
    load();
  }

  async function handleDelete(id: string) {
    await devicesApi.deleteBlockRule(deviceId, id);
    load();
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-sm">Block Rules</h2>
        <button onClick={() => setShowForm((s) => !s)} className="text-xs text-accent hover:underline">
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-50 rounded p-3 mb-3 space-y-2">
          <select
            value={ruleType}
            onChange={(e) => setRuleType(e.target.value as "app" | "website")}
            className="w-full border rounded px-2 py-1.5 text-xs"
          >
            <option value="app">App (package name)</option>
            <option value="website">Website (domain)</option>
          </select>
          <input
            placeholder={ruleType === "app" ? "e.g. com.android.chrome" : "e.g. instagram.com"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full border rounded px-2 py-1.5 text-xs font-mono"
          />
          <button
            onClick={handleCreate}
            className="bg-primary text-white text-xs px-3 py-1.5 rounded hover:bg-primary-dark"
          >
            Create (always-on — scheduling coming soon)
          </button>
        </div>
      )}

      {rules.length === 0 ? (
        <p className="text-xs text-gray-400">No block rules.</p>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="flex justify-between items-center text-xs border-b pb-2 last:border-0">
              <div>
                <span className="uppercase text-gray-400 mr-2">{r.rule_type}</span>
                <span className="font-mono">{r.target}</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.active}
                    onChange={() => toggleActive(r)}
                    className="accent-primary"
                  />
                  Active
                </label>
                <button onClick={() => handleDelete(r.id)} className="text-red-500 hover:underline">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
