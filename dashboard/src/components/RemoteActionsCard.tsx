import { useState } from "react";
import { devicesApi } from "../api/devices";
import { downloadFileViaRelay } from "../api/fileDownload";

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
  const [fileListLoading, setFileListLoading] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

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

  /** One click fetches the WHOLE device storage tree recursively — no per-folder navigation. */
  async function handleFileList() {
    setFileListLoading(true);
    setFiles(null);
    setStatus(null);
    try {
      const cmd = await devicesApi.createCommand(deviceId, "file_list");
      const result = await pollCommand(cmd.id, "File list");
      if (result?.status === "acked") {
        const full = await devicesApi.getCommand(deviceId, cmd.id);
        setFiles((full.result?.files as FileEntryDtoLocal[]) || []);
      }
    } finally {
      setFileListLoading(false);
    }
  }

  async function handleDownload(file: FileEntryDtoLocal) {
    setDownloadingPath(file.path);
    setStatus(`Preparing download: ${file.name}...`);
    try {
      const cmd = await devicesApi.createCommand(deviceId, "file_download", { path: file.path });
      // Connect to the relay right away — the admin side must be listening
      // before (or very shortly after) the device starts streaming.
      const downloadPromise = downloadFileViaRelay(cmd.id, (s) => setStatus(s));
      await pollCommand(cmd.id, `Download: ${file.name}`);
      await downloadPromise;
      setStatus(`Downloaded ${file.name}.`);
    } catch (e) {
      setStatus(`Download failed: ${(e as Error).message}`);
    } finally {
      setDownloadingPath(null);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <h2 className="font-semibold text-sm mb-4">Remote Actions</h2>
      <div className="flex flex-wrap gap-2 mb-3">
        <ActionButton onClick={handleLocationCheck} label="Check Location Now" />
        <ActionButton onClick={handleLock} label="Lock Device" />
        <ActionButton onClick={handleFileList} label="List Files" loading={fileListLoading} />
      </div>
      {status && <p className="text-xs text-gray-500 mb-3">{status}</p>}

      {files && (
        <div className="border rounded max-h-96 overflow-y-auto">
          {files.length === 0 ? (
            <p className="text-xs text-gray-400 p-3">No files found.</p>
          ) : (
            <table className="w-full text-xs">
              <tbody className="divide-y">
                {files.map((f) => {
                  const depth = f.path.split("/").length - 1;
                  return (
                    <tr key={f.path}>
                      <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + depth * 16}px` }}>
                        {f.isDirectory ? "📁" : "📄"} {f.name}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500 text-right whitespace-nowrap">
                        {f.sizeBytes != null ? formatSize(f.sizeBytes) : ""}
                      </td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap">
                        {!f.isDirectory && (
                          <button
                            onClick={() => handleDownload(f)}
                            disabled={downloadingPath === f.path}
                            className="text-accent hover:underline disabled:opacity-50 disabled:cursor-wait"
                          >
                            {downloadingPath === f.path ? "..." : "Download"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
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
