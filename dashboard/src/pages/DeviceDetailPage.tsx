import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { devicesApi } from "../api/devices";
import type { Device } from "../api/types";
import FeatureFlagsCard from "../components/FeatureFlagsCard";
import RemoteActionsCard from "../components/RemoteActionsCard";
import LocationCard from "../components/LocationCard";
import GeofencesCard from "../components/GeofencesCard";
import AppUsageChart from "../components/AppUsageChart";
import LogsTables from "../components/LogsTables";
import InstalledAppsCard from "../components/InstalledAppsCard";
import AlertsCard from "../components/AlertsCard";
import BlockRulesCard from "../components/BlockRulesCard";

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [device, setDevice] = useState<Device | null>(null);
  const [locationRefreshKey, setLocationRefreshKey] = useState(0);

  useEffect(() => {
    if (id) devicesApi.get(id).then(setDevice);
  }, [id]);

  if (!id) return null;
  if (!device) return <p className="text-sm text-gray-500">Loading...</p>;

  return (
    <div>
      <Link to="/devices" className="text-xs text-accent hover:underline">
        ← All devices
      </Link>

      <div className="flex items-center justify-between mt-2 mb-6">
        <div>
          <h1 className="text-xl font-bold text-primary-dark">{device.device_label}</h1>
          <p className="text-xs text-gray-500">
            {device.status} · {device.os_version || "unknown OS"} · last seen{" "}
            {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : "never"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {device.featureFlags && (
          <FeatureFlagsCard
            deviceId={id}
            flags={device.featureFlags}
            onUpdated={(flags) => setDevice({ ...device, featureFlags: flags })}
          />
        )}

        <RemoteActionsCard deviceId={id} onLocationUpdated={() => setLocationRefreshKey((k) => k + 1)} />
        <LocationCard deviceId={id} refreshKey={locationRefreshKey} />
        <GeofencesCard deviceId={id} />
        <AppUsageChart deviceId={id} />
        <InstalledAppsCard deviceId={id} />
        <BlockRulesCard deviceId={id} />
        <AlertsCard deviceId={id} />

        <div className="lg:col-span-2">
          <LogsTables deviceId={id} />
        </div>
      </div>
    </div>
  );
}
