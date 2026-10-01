import { useEffect, useState } from "react";
import { devicesApi } from "../api/devices";
import type { WebHistoryEntry } from "../api/types";

/**
 * Best-effort — see android-app WebHistoryCollector's doc comment. Modern
 * Chrome doesn't expose a history API to third-party apps, so this stays
 * empty on most devices; that's a platform limitation, not a sync bug.
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
          No browsing history synced. Modern Chrome doesn't allow third-party apps to read its
          history — this only picks up data on browsers with a legacy history provider.
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
