import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { devicesApi } from "../api/devices";
import type { Device } from "../api/types";

export default function DevicesListPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [createdDevice, setCreatedDevice] = useState<Device | null>(null);

  function load() {
    setLoading(true);
    devicesApi
      .list()
      .then(setDevices)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate() {
    if (!newLabel.trim()) return;
    const device = await devicesApi.create(newLabel.trim());
    setCreatedDevice(device);
    setNewLabel("");
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-primary-dark">Devices</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-primary text-white text-sm px-4 py-2 rounded hover:bg-primary-dark transition"
        >
          + Add Device
        </button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-lg shadow-sm p-5 mb-6">
          <h2 className="font-semibold text-sm mb-3">New Device</h2>
          <div className="flex gap-2">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Kid's Phone, Employee - Priya"
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              onClick={handleCreate}
              className="bg-primary text-white text-sm px-4 py-2 rounded hover:bg-primary-dark transition"
            >
              Create
            </button>
            <button
              onClick={() => {
                setShowCreate(false);
                setCreatedDevice(null);
              }}
              className="text-gray-500 text-sm px-2"
            >
              Cancel
            </button>
          </div>

          {createdDevice && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded p-4 text-sm">
              <p className="font-medium mb-1">Device created — share this code with the target device:</p>
              <code className="block bg-white border rounded px-3 py-2 font-mono text-xs break-all">
                {createdDevice.device_token}
              </code>
              <p className="text-gray-500 mt-2">
                Install the app on the target device, then enter this code on its activation screen.
              </p>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : devices.length === 0 ? (
        <p className="text-gray-500 text-sm">No devices yet. Click "Add Device" to get started.</p>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Label</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">OS</th>
                <th className="px-4 py-3 font-medium">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {devices.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/devices/${d.id}`} className="text-accent hover:underline font-medium">
                      {d.device_label}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{d.os_version || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "Never"}
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

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
    revoked: "bg-red-100 text-red-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100"}`}>
      {status}
    </span>
  );
}
