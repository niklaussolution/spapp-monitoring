import { useEffect, useState } from "react";
import { devicesApi } from "../api/devices";
import type { WebHistoryEntry } from "../api/types";

/**
 * Captured from the browser's address bar via the Accessibility Service
 * (BlockAccessibilityService), not Chrome's history directly — modern
 * Chrome exposes no history API to third-party apps at all. So this stays
 * empty until that service is enabled on the device, in addition to the
 * "Web history" feature flag being on.
 */
export default function WebHistoryCard({ deviceId }: { deviceId: string }) {
  const [entries, setEntries] = useState<WebHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    devicesApi.webHistory(deviceId).then(setEntries).finally(() => setLoading(false));
  }, [deviceId]);

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <h2 className="font-semibold text-sm mb-4">Web History ({entries.length})</h2>
      {loading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-gray-400">
          No browsing history synced yet. On the device, under Accessibility settings, make sure
          "Enable App/Website Blocking &amp; History" is turned on for Spapp Monitor — this
          feature reads it from the browser's address bar, since modern Chrome itself doesn't
          expose a history API to third-party apps.
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-400 text-left sticky top-0 bg-white">
              <tr>
                <th className="py-1 font-medium">Page</th>
                <th className="py-1 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e, i) => (
                <tr key={i}>
                  <td className="py-1.5">
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                      title={e.url}
                    >
                      {e.title || e.url}
                    </a>
                  </td>
                  <td className="py-1.5 text-gray-500 whitespace-nowrap">
                    {new Date(e.visited_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
