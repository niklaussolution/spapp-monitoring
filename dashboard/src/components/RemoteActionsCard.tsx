import { useState } from "react";
import { devicesApi } from "../api/devices";

interface FileEntryDtoLocal {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number | null;
  mimeType: string | null;
}

export default function RemoteActionsCard({
  deviceId,
  onLocationUpdated,
}: {
  deviceId: string;
  onLocationUpdated?: () => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntryDtoLocal[] | null>(null);

  async function pollCommand(commandId: string, label: string) {
    setStatus(`${label}: waiting for device...`);
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const cmd = await devicesApi.getCommand(deviceId, commandId);
      if (cmd.status === "acked") {
        setStatus(`${label}: completed.`);
        return cmd;
      }
      if (cmd.status === "failed") {
        setStatus(`${label}: failed.`);
        return cmd;
      }
    }
    setStatus(`${label}: still waiting (device may be offline) — will retry automatically.`);
    return null;
  }

  async function handleLocationCheck() {
    const cmd = await devicesApi.createCommand(deviceId, "location_check");
    const result = await pollCommand(cmd.id, "Location check");
    if (result?.status === "acked") {
      onLocationUpdated?.();
    }
  }

  async function handleLock() {
    const cmd = await devicesApi.createCommand(deviceId, "lock");
    await pollCommand(cmd.id, "Lock device");
  }

  async function handleFileList() {
    setFiles(null);
    const cmd = await devicesApi.createCommand(deviceId, "file_list");
    const result = await pollCommand(cmd.id, "File list");
    if (result?.status === "acked") {
      const full = await devicesApi.getCommand(deviceId, cmd.id);
      setFiles((full.result?.files as FileEntryDtoLocal[]) || []);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <h2 className="font-semibold text-sm mb-4">Remote Actions</h2>
      <div className="flex flex-wrap gap-2 mb-3">
        <ActionButton onClick={handleLocationCheck} label="Check Location Now" />
        <ActionButton onClick={handleLock} label="Lock Device" />
        <ActionButton onClick={handleFileList} label="List Files" />
      </div>
      {status && <p className="text-xs text-gray-500 mb-3">{status}</p>}

      {files && (
        <div className="border rounded mt-2">
          {files.length === 0 ? (
            <p className="text-xs text-gray-400 p-3">No files.</p>
          ) : (
            <table className="w-full text-xs">
              <tbody className="divide-y">
                {files.map((f) => (
                  <tr key={f.path}>
                    <td className="px-3 py-2">{f.isDirectory ? "📁" : "📄"} {f.name}</td>
                    <td className="px-3 py-2 text-gray-500">{f.sizeBytes != null ? `${f.sizeBytes} B` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ onClick, label }: { onClick: () => void; label: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      onClick={async () => {
        setLoading(true);
        try {
          await onClick();
        } finally {
          setLoading(false);
        }
      }}
      disabled={loading}
      className="bg-primary text-white text-xs px-3 py-2 rounded hover:bg-primary-dark transition disabled:opacity-50"
    >
      {loading ? "..." : label}
    </button>
  );
}
