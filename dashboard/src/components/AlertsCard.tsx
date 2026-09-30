import { useEffect, useState } from "react";
import { devicesApi } from "../api/devices";
import type { Alert } from "../api/types";

export default function AlertsCard({ deviceId }: { deviceId: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    devicesApi.alerts(deviceId).then(setAlerts);
  }, [deviceId]);

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <h2 className="font-semibold text-sm mb-4">Alerts ({alerts.length})</h2>
      {alerts.length === 0 ? (
        <p className="text-xs text-gray-400">No alerts.</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {alerts.map((a) => (
            <div key={a.id} className="text-xs border-b pb-2 last:border-0">
              <div className="flex justify-between">
                <span className="font-medium">{alertLabel(a.alert_type)}</span>
                <span className="text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
              </div>
              <p className="text-gray-600">{a.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function alertLabel(type: string): string {
  switch (type) {
    case "geofence_breach":
      return "📍 Geofence";
    case "block_violation":
      return "🚫 Block attempt";
    case "device_offline":
      return "⚠️ Offline";
    default:
      return type;
  }
}
