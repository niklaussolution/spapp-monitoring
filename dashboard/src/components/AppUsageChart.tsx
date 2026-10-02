import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { devicesApi } from "../api/devices";
import type { AppUsageEntry } from "../api/types";
import { usePolling } from "../hooks/usePolling";

const AUTO_REFRESH_MS = 20000;

export default function AppUsageChart({ deviceId }: { deviceId: string }) {
  const [entries, setEntries] = useState<AppUsageEntry[]>([]);

  usePolling(() => {
    devicesApi.appUsage(deviceId).then(setEntries);
  }, AUTO_REFRESH_MS, [deviceId]);

  const chartData = entries
    .slice()
    .sort((a, b) => b.usage_seconds - a.usage_seconds)
    .slice(0, 8)
    .map((e) => ({
      name: e.app_name || e.package_name.split(".").pop() || e.package_name,
      minutes: Math.round(e.usage_seconds / 60),
    }));

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <h2 className="font-semibold text-sm mb-4">App Usage (top apps, minutes)</h2>
      {chartData.length === 0 ? (
        <p className="text-xs text-gray-400">No usage data synced yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" fontSize={11} />
            <YAxis type="category" dataKey="name" width={90} fontSize={11} />
            <Tooltip />
            <Bar dataKey="minutes" fill="#0F3460" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
