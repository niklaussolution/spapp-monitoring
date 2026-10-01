import { useState } from "react";
import { devicesApi } from "../api/devices";

interface FileEntryDtoLocal {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number | null;
  mimeType: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [currentPath, setCurrentPath] = useState("");
  const [fileListLoading, setFileListLoading] = useState(false);

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

  async function loadFileList(path: string) {
    setFileListLoading(true);
    setStatus(null);
    try {
      const cmd = await devicesApi.createCommand(deviceId, "file_list", path ? { path } : undefined);
      const result = await pollCommand(cmd.id, "File list");
      if (result?.status === "acked") {
        const full = await devicesApi.getCommand(deviceId, cmd.id);
        setFiles((full.result?.files as FileEntryDtoLocal[]) || []);
        setCurrentPath(path);
      }
    } finally {
      setFileListLoading(false);
    }
  }

  function handleEntryClick(entry: FileEntryDtoLocal) {
    if (entry.isDirectory) {
      loadFileList(entry.path);
    }
  }

  function handleUpClick() {
    const parent = currentPath.split("/").slice(0, -1).join("/");
    loadFileList(parent);
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <h2 className="font-semibold text-sm mb-4">Remote Actions</h2>
      <div className="flex flex-wrap gap-2 mb-3">
        <ActionButton onClick={handleLocationCheck} label="Check Location Now" />
        <ActionButton onClick={handleLock} label="Lock Device" />
        <ActionButton onClick={() => loadFileList("")} label="List Files" loading={fileListLoading} />
      </div>
      {status && <p className="text-xs text-gray-500 mb-3">{status}</p>}

      {files && (
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1 px-1">
            {currentPath && (
              <button onClick={handleUpClick} className="text-accent hover:underline">
                ⬆ Up
              </button>
            )}
            <span className="font-mono truncate">/{currentPath}</span>
          </div>
          <div className="border rounded max-h-80 overflow-y-auto">
            {files.length === 0 ? (
              <p className="text-xs text-gray-400 p-3">Empty folder.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody className="divide-y">
                  {files.map((f) => (
                    <tr
                      key={f.path}
                      onClick={() => handleEntryClick(f)}
                      className={f.isDirectory ? "cursor-pointer hover:bg-gray-50" : ""}
                    >
                      <td className="px-3 py-2">
                        {f.isDirectory ? "📁" : "📄"} {f.name}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-right">
                        {f.sizeBytes != null ? formatSize(f.sizeBytes) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  label,
  loading: externalLoading,
}: {
  onClick: () => void;
  label: string;
  loading?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const isLoading = externalLoading ?? loading;
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
      disabled={isLoading}
      className="bg-primary text-white text-xs px-3 py-2 rounded hover:bg-primary-dark transition disabled:opacity-50"
    >
      {isLoading ? "..." : label}
    </button>
  );
}
