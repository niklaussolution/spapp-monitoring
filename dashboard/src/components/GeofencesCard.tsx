import { useEffect, useState } from "react";
import { devicesApi } from "../api/devices";
import type { Geofence } from "../api/types";

export default function GeofencesCard({ deviceId }: { deviceId: string }) {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("500");

  function load() {
    devicesApi.listGeofences(deviceId).then(setGeofences);
  }

  useEffect(load, [deviceId]);

  async function handleCreate() {
    if (!name || !lat || !lng) return;
    await devicesApi.createGeofence(deviceId, {
      name,
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      radiusM: parseInt(radius, 10) || 500,
    });
    setName("");
    setLat("");
    setLng("");
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    await devicesApi.deleteGeofence(deviceId, id);
    load();
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-sm">Geofences</h2>
        <button onClick={() => setShowForm((s) => !s)} className="text-xs text-accent hover:underline">
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-50 rounded p-3 mb-3 space-y-2">
          <input
            placeholder="Name (e.g. Home, School)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded px-2 py-1.5 text-xs"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              placeholder="Latitude"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="border rounded px-2 py-1.5 text-xs"
            />
            <input
              placeholder="Longitude"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className="border rounded px-2 py-1.5 text-xs"
            />
            <input
              placeholder="Radius (m)"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              className="border rounded px-2 py-1.5 text-xs"
            />
          </div>
          <button
            onClick={handleCreate}
            className="bg-primary text-white text-xs px-3 py-1.5 rounded hover:bg-primary-dark"
          >
            Create
          </button>
        </div>
      )}

      {geofences.length === 0 ? (
        <p className="text-xs text-gray-400">No geofences defined.</p>
      ) : (
        <div className="space-y-2">
          {geofences.map((g) => (
            <div key={g.id} className="flex justify-between items-center text-xs border-b pb-2 last:border-0">
              <div>
                <span className="font-medium">{g.name}</span>
                <span className="text-gray-400 ml-2 font-mono">
                  {g.latitude.toFixed(4)}, {g.longitude.toFixed(4)} · {g.radius_m}m
                </span>
              </div>
              <button onClick={() => handleDelete(g.id)} className="text-red-500 hover:underline">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
