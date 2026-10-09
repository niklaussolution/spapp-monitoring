import { useEffect } from "react";
import ScreenStreamView from "./ScreenStreamView";

interface ScreenStreamModalProps {
  isOpen: boolean;
  onClose: () => void;
  deviceId: string;
  deviceName?: string;
}

export default function ScreenStreamModal({
  isOpen,
  onClose,
  deviceId,
  deviceName,
}: ScreenStreamModalProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePopOut = () => {
    const width = 450;
    const height = 860;
    const left = window.screen.width ? (window.screen.width - width) / 2 : 100;
    const top = window.screen.height ? (window.screen.height - height) / 2 : 100;

    window.open(
      `/devices/${encodeURIComponent(deviceId)}/screen-stream`,
      `spapp_stream_${deviceId}`,
      `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=no,status=no,toolbar=no`
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden w-full max-w-[440px] max-h-[95vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <ScreenStreamView
          deviceId={deviceId}
          deviceName={deviceName}
          isStandalone={false}
          onClose={onClose}
          onPopOut={handlePopOut}
        />
      </div>
    </div>
  );
}
