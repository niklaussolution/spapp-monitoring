import { useState } from "react";
import { devicesApi } from "../api/devices";
import type { InstalledApp } from "../api/types";
import { usePolling } from "../hooks/usePolling";

const AUTO_REFRESH_MS = 20000;

export default function InstalledAppsCard({ deviceId }: { deviceId: string }) {
  const [apps, setApps] = useState<InstalledApp[]>([]);

  usePolling(() => {
    devicesApi.installedApps(deviceId).then(setApps);
  }, AUTO_REFRESH_MS, [deviceId]);

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <h2 className="font-semibold text-sm mb-4">Installed Apps ({apps.length})</h2>
      {apps.length === 0 ? (
        <p className="text-xs text-gray-400">No inventory synced yet.</p>
      ) : (
        <div className="max-h-80 overflow-y-auto grid grid-cols-4 sm:grid-cols-5 gap-3">
          {apps.map((a) => (
            <div
              key={a.package_name}
              className="flex flex-col items-center text-center gap-1"
              title={a.package_name}
            >
              {a.icon_base64 ? (
                <img
                  src={`data:image/png;base64,${a.icon_base64}`}
                  alt=""
                  className="w-9 h-9 rounded"
                />
              ) : (
                <div className="w-9 h-9 rounded bg-gray-100 flex items-center justify-center text-sm font-semibold text-gray-400">
                  {(a.app_name || a.package_name).charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-[10px] leading-tight text-gray-600 line-clamp-2">
                {a.app_name || a.package_name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
