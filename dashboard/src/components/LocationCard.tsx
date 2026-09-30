import { useEffect, useState } from "react";
import { devicesApi } from "../api/devices";
import type { LocationPoint } from "../api/types";

export default function LocationCard({ deviceId, refreshKey }: { deviceId: string; refreshKey?: number }) {
  const [points, setPoints] = useState<LocationPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    devicesApi
      .locationHistory(deviceId, 20)
      .then(setPoints)
      .finally(() => setLoading(false));
    // refreshKey isn't read here — it's only in the dependency array so a
    // bump from RemoteActionsCard (after "Check Location Now" acks) triggers
    // a refetch, instead of the list staying stale until the next full page load.
  }, [deviceId, refreshKey]);

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <h2 className="font-semibold text-sm mb-4">Location History</h2>
      {loading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : points.length === 0 ? (
        <p className="text-xs text-gray-400">
          No location points yet — use "Check Location Now" to request one.
        </p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {points.map((p, i) => (
            <div key={i} className="flex justify-between items-center text-xs border-b pb-2 last:border-0">
              <div>
                <a
                  href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline font-mono"
                >
                  {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                </a>
                <span className="ml-2 text-gray-400">
                  {p.source === "geofence_event" ? "📍 geofence" : "🎯 on-demand"}
                </span>
              </div>
              <span className="text-gray-500">{new Date(p.recorded_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
