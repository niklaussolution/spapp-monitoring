import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { devicesApi } from "../api/devices";
import ScreenStreamView from "../components/ScreenStreamView";

export default function ScreenStreamPage() {
  const { id } = useParams<{ id: string }>();
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
      <ScreenStreamView
        deviceId={id}
        deviceName={deviceLabel}
        isStandalone={true}
        onClose={() => window.close()}
      />
    </div>
  );
}
