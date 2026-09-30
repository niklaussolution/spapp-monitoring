import { devicesApi } from "../api/devices";
import type { FeatureFlags } from "../api/types";

const FLAG_LABELS: Record<keyof Omit<FeatureFlags, "device_id" | "updated_at">, string> = {
  location_on_demand: "Location (on-demand)",
  geofencing: "Geofencing",
  app_usage_tracking: "App usage tracking",
  web_history_tracking: "Web history",
  app_blocking: "App/website blocking",
  sms_log: "SMS log",
  call_log: "Call log",
  remote_lock: "Remote lock",
  file_manager: "File manager",
  installed_apps_list: "Installed apps list",
};

export default function FeatureFlagsCard({
  deviceId,
  flags,
  onUpdated,
}: {
  deviceId: string;
  flags: FeatureFlags;
  onUpdated: (flags: FeatureFlags) => void;
}) {
  async function toggle(key: keyof typeof FLAG_LABELS) {
    const updated = await devicesApi.updateFeatureFlags(deviceId, { [key]: !flags[key] });
    onUpdated(updated);
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <h2 className="font-semibold text-sm mb-4">Feature Scope</h2>
      <div className="grid grid-cols-2 gap-3">
        {(Object.keys(FLAG_LABELS) as Array<keyof typeof FLAG_LABELS>).map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={Boolean(flags[key])}
              onChange={() => toggle(key)}
              className="rounded accent-primary"
            />
            {FLAG_LABELS[key]}
          </label>
        ))}
      </div>
    </div>
  );
}
