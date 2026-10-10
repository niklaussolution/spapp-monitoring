import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { devicesApi } from "../api/devices";
import CameraStreamView from "../components/CameraStreamView";

export default function CameraStreamPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const initialLens = (searchParams.get("lens") === "front" ? "front" : "back") as "front" | "back";
  const [deviceLabel, setDeviceLabel] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    devicesApi
      .get(id)
      .then((d) => setDeviceLabel(d.device_label))
      .catch(() => {});
  }, [id]);

  if (!id) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center p-4">
        <p className="text-sm">Device ID missing.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center overflow-x-hidden">
      <CameraStreamView
        deviceId={id}
        deviceName={deviceLabel}
        initialLens={initialLens}
        isStandalone={true}
        onClose={() => window.close()}
      />
    </div>
  );
}
