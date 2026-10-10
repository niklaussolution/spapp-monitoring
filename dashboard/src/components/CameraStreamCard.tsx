import { useState } from "react";
import CameraStreamView from "./CameraStreamView";

interface CameraStreamCardProps {
  deviceId: string;
  deviceName?: string;
  isActive?: boolean;
  initialLens?: "front" | "back";
  onToggleActive?: (active: boolean) => void;
}

export default function CameraStreamCard({
  deviceId,
  deviceName,
  isActive: externalActive,
  initialLens: externalLens = "back",
  onToggleActive,
}: CameraStreamCardProps) {
  const [internalActive, setInternalActive] = useState(false);
  const [selectedLens, setSelectedLens] = useState<"front" | "back">(externalLens);

  const isControlled = externalActive !== undefined;
  const active = isControlled ? externalActive : internalActive;

  const setActive = (val: boolean, lens?: "front" | "back") => {
    if (lens) setSelectedLens(lens);
    if (isControlled && onToggleActive) {
      onToggleActive(val);
    } else {
      setInternalActive(val);
    }
  };

  if (active) {
    return (
      <div
        id="live-camera-card"
        className="bg-slate-950 rounded-xl shadow-lg border border-slate-800 overflow-hidden flex flex-col transition-all duration-300"
      >
        <CameraStreamView
          deviceId={deviceId}
          deviceName={deviceName}
          initialLens={selectedLens}
          isStandalone={false}
          onClose={() => setActive(false)}
        />
      </div>
    );
  }

  return (
    <div
      id="live-camera-card"
      className="bg-white rounded-xl shadow-sm p-5 border border-slate-100 flex flex-col justify-between transition-all duration-300"
    >
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
            <h2 className="font-semibold text-sm text-slate-800">Live Camera Stream</h2>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-500 uppercase tracking-wider">
            Standby
          </span>
        </div>

        <div className="flex flex-col items-center justify-center p-8 text-center bg-slate-50/80 rounded-xl border border-dashed border-slate-200 my-2">
          <div className="w-12 h-12 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Live Camera Feed</h3>
          <p className="text-xs text-slate-500 max-w-sm leading-relaxed mb-5">
            Select a camera lens below to begin real-time streaming directly in this dashboard.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 w-full max-w-xs">
            <button
              onClick={() => setActive(true, "front")}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold rounded-lg shadow-sm hover:shadow transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Front Camera</span>
            </button>

            <button
              onClick={() => setActive(true, "back")}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold rounded-lg shadow-sm hover:shadow transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Back Camera</span>
            </button>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 mt-3 text-center">
        💡 Requires Camera permission and active internet connection on the target phone.
      </p>
    </div>
  );
}
