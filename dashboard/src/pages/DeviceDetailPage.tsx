import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { devicesApi } from "../api/devices";
import type { Device } from "../api/types";
import FeatureFlagsCard from "../components/FeatureFlagsCard";
import RemoteActionsCard from "../components/RemoteActionsCard";
import LocationCard from "../components/LocationCard";
import GeofencesCard from "../components/GeofencesCard";
import AppUsageChart from "../components/AppUsageChart";
import LogsTables from "../components/LogsTables";
import InstalledAppsCard from "../components/InstalledAppsCard";
import WebHistoryCard from "../components/WebHistoryCard";
import AlertsCard from "../components/AlertsCard";
import BlockRulesCard from "../components/BlockRulesCard";

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<Device | null>(null);
  const [locationRefreshKey, setLocationRefreshKey] = useState(0);
  const [deactivating, setDeactivating] = useState(false);

  useEffect(() => {
    if (!id) return;
    devicesApi.get(id).then((d) => {
      // Deactivated devices live on their own read-only archive page now
      // (see DeviceArchivePage) — this live view assumes a device that's
      // still syncing, so redirect rather than show stale "Remote Actions"
      // buttons that would just hang forever.
      if (d.status === "revoked") {
        navigate(`/devices/${id}/archive`, { replace: true });
        return;
      }
      setDevice(d);
    });
  }, [id, navigate]);

  if (!id) return null;
  if (!device) return <p className="text-sm text-gray-500">Loading...</p>;

  async function handleDeactivate() {
    if (!id) return;
    if (
      !confirm(
        "Deactivate this device? It will stop syncing immediately. Its history is kept, and you can reconnect it later with the same device code."
      )
    ) {
      return;
    }
    setDeactivating(true);
    try {
      await devicesApi.deactivate(id);
      navigate(`/devices/${id}/archive`, { replace: true });
    } finally {
      setDeactivating(false);
    }
  }

  return (
    <div>
      <Link to="/devices" className="text-xs text-accent hover:underline">
        ← All devices
      </Link>

      <div className="flex items-center justify-between mt-2 mb-6">
        <div>
          <h1 className="text-xl font-bold text-primary-dark">{device.device_label}</h1>
          <p className="text-xs text-gray-500">
            {device.status} · {device.os_version || "unknown OS"} ·
            last seen {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : "never"}
          </p>
        </div>
        <button
          onClick={handleDeactivate}
          disabled={deactivating}
          className="text-red-600 border border-red-200 text-sm px-4 py-2 rounded hover:bg-red-50 transition disabled:opacity-50"
        >
          {deactivating ? "Deactivating..." : "Deactivate Device"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {device.featureFlags && (
          <FeatureFlagsCard
            deviceId={id}
            flags={device.featureFlags}
            permissionStatus={device.permission_status}
            onUpdated={(flags) => setDevice({ ...device, featureFlags: flags })}
          />
        )}

        <RemoteActionsCard deviceId={id} onLocationUpdated={() => setLocationRefreshKey((k) => k + 1)} />
        <LocationCard deviceId={id} refreshKey={locationRefreshKey} />
        <GeofencesCard deviceId={id} />
        <AppUsageChart deviceId={id} />
        <InstalledAppsCard deviceId={id} />
        <WebHistoryCard deviceId={id} />
        <BlockRulesCard deviceId={id} />
        <AlertsCard deviceId={id} />

        <div className="lg:col-span-2">
          <LogsTables deviceId={id} />
        </div>
      </div>
    </div>
  );
}
