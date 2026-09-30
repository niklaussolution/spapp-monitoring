import { useEffect, useState } from "react";
import { devicesApi } from "../api/devices";
import type { InstalledApp } from "../api/types";

export default function InstalledAppsCard({ deviceId }: { deviceId: string }) {
  const [apps, setApps] = useState<InstalledApp[]>([]);

  useEffect(() => {
    devicesApi.installedApps(deviceId).then(setApps);
  }, [deviceId]);

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <h2 className="font-semibold text-sm mb-4">Installed Apps ({apps.length})</h2>
      {apps.length === 0 ? (
        <p className="text-xs text-gray-400">No inventory synced yet.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-1">
          {apps.map((a) => (
            <div key={a.package_name} className="flex justify-between text-xs py-1 border-b last:border-0">
              <span>{a.app_name || a.package_name}</span>
              <span className="text-gray-400 font-mono">{a.package_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
