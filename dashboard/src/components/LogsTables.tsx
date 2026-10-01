import { useEffect, useRef, useState } from "react";
import { devicesApi } from "../api/devices";
import type { CallLogEntry, SmsLogEntry } from "../api/types";

// Contained scroll area so up to 100 rows stay inside the card instead of
// growing the whole dashboard page ("page down" scrolling) — same pattern
// as the other cards (Location History, Installed Apps).
const SCROLL_CLASS = "max-h-80 overflow-y-auto";
const AUTO_REFRESH_MS = 20000; // "live update" — the device syncs in the background on its own schedule

export default function LogsTables({ deviceId }: { deviceId: string }) {
  const [tab, setTab] = useState<"calls" | "sms">("calls");
  const [calls, setCalls] = useState<CallLogEntry[]>([]);
  const [sms, setSms] = useState<SmsLogEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    setRefreshing(true);
    Promise.all([devicesApi.callLog(deviceId), devicesApi.smsLog(deviceId)])
      .then(([c, s]) => {
        setCalls(c);
        setSms(s);
      })
      .finally(() => setRefreshing(false));
  }

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
    const interval = setInterval(() => loadRef.current(), AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [deviceId]);

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-4 border-b">
        <div className="flex gap-4">
          <TabButton active={tab === "calls"} onClick={() => setTab("calls")} label={`Call Log (${calls.length})`} />
          <TabButton active={tab === "sms"} onClick={() => setTab("sms")} label={`SMS Log (${sms.length})`} />
        </div>
        <button
          onClick={load}
          className="text-xs text-gray-400 hover:text-accent pb-2 flex items-center gap-1"
          title="Refresh now"
        >
          {refreshing ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      {tab === "calls" &&
        (calls.length === 0 ? (
          <p className="text-xs text-gray-400">No call log data synced yet.</p>
        ) : (
          <div className={SCROLL_CLASS}>
            <table className="w-full text-xs">
              <thead className="text-gray-400 text-left sticky top-0 bg-white">
                <tr>
                  <th className="py-1 font-medium">Number</th>
                  <th className="py-1 font-medium">Direction</th>
                  <th className="py-1 font-medium">Duration</th>
                  <th className="py-1 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {calls.map((c, i) => (
                  <tr key={i}>
                    <td className="py-1.5 font-mono">{c.counterparty}</td>
                    <td className="py-1.5">{c.direction}</td>
                    <td className="py-1.5">{c.duration_sec}s</td>
                    <td className="py-1.5 text-gray-500">{new Date(c.called_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "sms" &&
        (sms.length === 0 ? (
          <p className="text-xs text-gray-400">No SMS log data synced yet.</p>
        ) : (
          <div className={SCROLL_CLASS}>
            <table className="w-full text-xs">
              <thead className="text-gray-400 text-left sticky top-0 bg-white">
                <tr>
                  <th className="py-1 font-medium">Number</th>
                  <th className="py-1 font-medium">Direction</th>
                  <th className="py-1 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sms.map((s, i) => (
                  <tr key={i}>
                    <td className="py-1.5 font-mono">{s.counterparty}</td>
                    <td className="py-1.5">{s.direction}</td>
                    <td className="py-1.5 text-gray-500">{new Date(s.message_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`pb-2 text-sm font-medium border-b-2 transition ${
        active ? "border-accent text-accent" : "border-transparent text-gray-400 hover:text-gray-600"
      }`}
    >
      {label}
    </button>
  );
}
