import { useEffect, useState } from "react";
import { devicesApi } from "../api/devices";
import type { CallLogEntry, SmsLogEntry } from "../api/types";

export default function LogsTables({ deviceId }: { deviceId: string }) {
  const [tab, setTab] = useState<"calls" | "sms">("calls");
  const [calls, setCalls] = useState<CallLogEntry[]>([]);
  const [sms, setSms] = useState<SmsLogEntry[]>([]);

  useEffect(() => {
    devicesApi.callLog(deviceId).then(setCalls);
    devicesApi.smsLog(deviceId).then(setSms);
  }, [deviceId]);

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex gap-4 mb-4 border-b">
        <TabButton active={tab === "calls"} onClick={() => setTab("calls")} label={`Call Log (${calls.length})`} />
        <TabButton active={tab === "sms"} onClick={() => setTab("sms")} label={`SMS Log (${sms.length})`} />
      </div>

      {tab === "calls" &&
        (calls.length === 0 ? (
          <p className="text-xs text-gray-400">No call log data synced yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-gray-400 text-left">
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
        ))}

      {tab === "sms" &&
        (sms.length === 0 ? (
          <p className="text-xs text-gray-400">No SMS log data synced yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-gray-400 text-left">
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
