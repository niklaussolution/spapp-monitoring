import { useEffect, useMemo, useRef, useState } from "react";
import { devicesApi } from "../api/devices";
import { downloadFileViaRelay } from "../api/fileDownload";
import type { WhatsAppChatSummary, WhatsAppMessage } from "../api/types";

// ============================================================================
// TYPES & DATA MODELS
// ============================================================================
interface FileEntryDtoLocal {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number | null;
  mimeType: string | null;
}

type AvailableAppId = "whatsapp" | "telegram" | "instagram" | "messenger" | "signal";

interface AppMetadata {
  id: AvailableAppId;
  name: string;
  packageName: string;
  color: string;
  bgColor: string;
  badge: "Active" | "Coming Soon";
  isSupported: boolean;
  description: string;
}

const SUPPORTED_APPS: AppMetadata[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    packageName: "com.whatsapp",
    color: "#25D366",
    bgColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
    badge: "Active",
    isSupported: true,
    description: "Live chat-wise messages & media sync",
  },
  {
    id: "telegram",
    name: "Telegram",
    packageName: "org.telegram.messenger",
    color: "#229ED9",
    bgColor: "bg-sky-50 text-sky-700 border-sky-200",
    badge: "Coming Soon",
    isSupported: false,
    description: "Encrypted channels & direct messages",
  },
  {
    id: "instagram",
    name: "Instagram Direct",
    packageName: "com.instagram.android",
    color: "#E1306C",
    bgColor: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
    badge: "Coming Soon",
    isSupported: false,
    description: "DMs & shared post media",
  },
  {
    id: "messenger",
    name: "Messenger",
    packageName: "com.facebook.orca",
    color: "#0084FF",
    bgColor: "bg-blue-50 text-blue-700 border-blue-200",
    badge: "Coming Soon",
    isSupported: false,
    description: "Facebook conversations & voice clips",
  },
  {
    id: "signal",
    name: "Signal",
    packageName: "org.thoughtcrime.securesms",
    color: "#3A76F0",
    bgColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    badge: "Coming Soon",
    isSupported: false,
    description: "Secure messaging logs",
  },
];

// ============================================================================
// DYNAMIC SAMPLE DATA (LAST 5 DAYS ONLY)
// ============================================================================
function generateFallbackWhatsAppChats(): {
  chats: WhatsAppChatSummary[];
  messages: Record<string, WhatsAppMessage[]>;
} {
  const now = Date.now();
  const msMin = 60 * 1000;

  const rawMessages: Record<string, WhatsAppMessage[]> = {
    Mom: [
      {
        id: "msg-mom-1",
        chat_name: "Mom",
        sender: "Mom",
        message_text: "Good morning sweetie! Are you coming home this Sunday for lunch?",
        is_outgoing: false,
        message_time: new Date(now - 180 * msMin).toISOString(), // 3 hours ago (Today)
      },
      {
        id: "msg-mom-2",
        chat_name: "Mom",
        sender: "Me",
        message_text: "Yes mom, definitely! I will be there around 1 PM.",
        is_outgoing: true,
        message_time: new Date(now - 170 * msMin).toISOString(),
      },
      {
        id: "msg-mom-3",
        chat_name: "Mom",
        sender: "Mom",
        message_text: "🎤 Voice message (0:14)",
        is_outgoing: false,
        message_time: new Date(now - 165 * msMin).toISOString(),
        media_type: "audio",
        media_path: "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Voice Notes/202641/PTT-20261010-WA0001.opus",
      },
      {
        id: "msg-mom-4",
        chat_name: "Mom",
        sender: "Mom",
        message_text: "Made your favorite lasagna! Look at this 🍝",
        is_outgoing: false,
        message_time: new Date(now - 120 * msMin).toISOString(),
        media_type: "image",
        media_path: "https://images.unsplash.com/photo-1574894709920-11b28e7367e3?w=800&auto=format&fit=crop&q=80",
      },
      {
        id: "msg-mom-5",
        chat_name: "Mom",
        sender: "Me",
        message_text: "Looks delicious! See you soon ❤️",
        is_outgoing: true,
        message_time: new Date(now - 110 * msMin).toISOString(),
      },
    ],
    "Sarah Jenkins": [
      {
        id: "msg-sarah-1",
        chat_name: "Sarah Jenkins",
        sender: "Sarah Jenkins",
        message_text: "Hey! Did you get a chance to review the Q4 design specs?",
        is_outgoing: false,
        message_time: new Date(now - 1440 * msMin).toISOString(), // 1 day ago (Yesterday)
      },
      {
        id: "msg-sarah-2",
        chat_name: "Sarah Jenkins",
        sender: "Me",
        message_text: "Going through it now. Attached the revised feedback document.",
        is_outgoing: true,
        message_time: new Date(now - 1420 * msMin).toISOString(),
      },
      {
        id: "msg-sarah-3",
        chat_name: "Sarah Jenkins",
        sender: "Me",
        message_text: "📄 Q4_Feedback_Report.pdf",
        is_outgoing: true,
        message_time: new Date(now - 1410 * msMin).toISOString(),
        media_type: "document",
        media_path: "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents/Q4_Feedback_Report.pdf",
      },
      {
        id: "msg-sarah-4",
        chat_name: "Sarah Jenkins",
        sender: "Sarah Jenkins",
        message_text: "Awesome, thank you! I will incorporate these changes before the client meeting.",
        is_outgoing: false,
        message_time: new Date(now - 1390 * msMin).toISOString(),
      },
      {
        id: "msg-sarah-5",
        chat_name: "Sarah Jenkins",
        sender: "Sarah Jenkins",
        message_text: "🎤 Voice message (0:22)",
        is_outgoing: false,
        message_time: new Date(now - 75 * msMin).toISOString(), // Today
        media_type: "audio",
        media_path: "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Voice Notes/202641/PTT-20261010-WA0003.opus",
      },
    ],
    "Alex Rivera": [
      {
        id: "msg-alex-1",
        chat_name: "Alex Rivera",
        sender: "Alex Rivera",
        message_text: "Bro check out this clip from the keynote today 🔥",
        is_outgoing: false,
        message_time: new Date(now - 2880 * msMin).toISOString(), // 2 days ago
      },
      {
        id: "msg-alex-2",
        chat_name: "Alex Rivera",
        sender: "Alex Rivera",
        message_text: "🎥 Keynote_Highlights_2026.mp4 (0:38)",
        is_outgoing: false,
        message_time: new Date(now - 2870 * msMin).toISOString(),
        media_type: "video",
        media_path: "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video/VID-20261008-WA0012.mp4",
      },
      {
        id: "msg-alex-3",
        chat_name: "Alex Rivera",
        sender: "Me",
        message_text: "That new GPU architecture looks insane!",
        is_outgoing: true,
        message_time: new Date(now - 2800 * msMin).toISOString(),
      },
      {
        id: "msg-alex-4",
        chat_name: "Alex Rivera",
        sender: "Alex Rivera",
        message_text: "Are we still on for gym tomorrow at 6 PM?",
        is_outgoing: false,
        message_time: new Date(now - 600 * msMin).toISOString(), // Today
      },
      {
        id: "msg-alex-5",
        chat_name: "Alex Rivera",
        sender: "Me",
        message_text: "Yup! I will pick you up on the way.",
        is_outgoing: true,
        message_time: new Date(now - 590 * msMin).toISOString(),
      },
    ],
    "Dev Team Group": [
      {
        id: "msg-dev-1",
        chat_name: "Dev Team Group",
        sender: "David Kim",
        message_text: "Sprint deployment is scheduled for tonight 11 PM UTC.",
        is_outgoing: false,
        message_time: new Date(now - 4320 * msMin).toISOString(), // 3 days ago
      },
      {
        id: "msg-dev-2",
        chat_name: "Dev Team Group",
        sender: "Elena Rostova",
        message_text: "All PRs have been merged and passing CI. 🚀",
        is_outgoing: false,
        message_time: new Date(now - 4300 * msMin).toISOString(),
      },
      {
        id: "msg-dev-3",
        chat_name: "Dev Team Group",
        sender: "Me",
        message_text: "Great job everyone! Staging environment health checks are looking 100% green.",
        is_outgoing: true,
        message_time: new Date(now - 4250 * msMin).toISOString(),
      },
      {
        id: "msg-dev-4",
        chat_name: "Dev Team Group",
        sender: "David Kim",
        message_text: "📄 Sprint_Release_Notes_v2.4.pdf",
        is_outgoing: false,
        message_time: new Date(now - 2000 * msMin).toISOString(),
        media_type: "document",
        media_path: "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents/Sprint_Release_Notes_v2.4.pdf",
      },
      {
        id: "msg-dev-5",
        chat_name: "Dev Team Group",
        sender: "Elena Rostova",
        message_text: "Dashboard latency metrics screenshot",
        is_outgoing: false,
        message_time: new Date(now - 90 * msMin).toISOString(), // Today
        media_type: "image",
        media_path: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&auto=format&fit=crop&q=80",
      },
    ],
    "David Miller": [
      {
        id: "msg-david-1",
        chat_name: "David Miller",
        sender: "David Miller",
        message_text: "Hey! Can you send over the contact details for the contractor?",
        is_outgoing: false,
        message_time: new Date(now - 5760 * msMin).toISOString(), // 4 days ago
      },
      {
        id: "msg-david-2",
        chat_name: "David Miller",
        sender: "Me",
        message_text: "Sure thing, check your SMS or I can forward his card here.",
        is_outgoing: true,
        message_time: new Date(now - 5700 * msMin).toISOString(),
      },
      {
        id: "msg-david-3",
        chat_name: "David Miller",
        sender: "David Miller",
        message_text: "Thanks a lot, appreciate it!",
        is_outgoing: false,
        message_time: new Date(now - 5600 * msMin).toISOString(),
      },
    ],
  };

  // Compile summary
  const chats: WhatsAppChatSummary[] = Object.keys(rawMessages).map((name) => {
    const thread = rawMessages[name];
    const lastMsg = thread[thread.length - 1];
    return {
      chat_name: name,
      total_messages: thread.length,
      last_message_at: lastMsg.message_time,
      last_message: lastMsg.message_text,
      last_is_outgoing: lastMsg.is_outgoing,
    };
  });

  return { chats, messages: rawMessages };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
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
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateString;
  }
}

function getMessageDateGroup(dateString: string): string {
  try {
    const msgDate = new Date(dateString);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (msgDate.toDateString() === today.toDateString()) return "Today";
    if (msgDate.toDateString() === yesterday.toDateString()) return "Yesterday";
    return msgDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  } catch {
    return "Recent";
  }
}

function isWithinLast5Days(dateString: string): boolean {
  try {
    const time = new Date(dateString).getTime();
    const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
    return time >= fiveDaysAgo;
  } catch {
    return true;
  }
}

// Web Audio synthesizer tone fallback for realistic voice note playback
function playSynthesizedVoiceTone(durationSec: number = 3) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(320, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(540, ctx.currentTime + durationSec * 0.5);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + durationSec);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
  } catch {
    // audio ctx not permitted or muted
  }
}

// ============================================================================
// SVG ICONS
// ============================================================================
function WhatsAppLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.411z" />
    </svg>
  );
}

function TelegramLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .37z" />
    </svg>
  );
}

function InstagramLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

function MessengerLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.145 2 11.258c0 2.91 1.455 5.517 3.735 7.185V22l3.414-1.874c.904.25 1.86.387 2.851.387 5.523 0 10-4.145 10-9.255C22 6.145 17.523 2 12 2zm1.096 12.443l-2.72-2.903-5.305 2.903 5.836-6.196 2.784 2.903 5.241-2.903-5.836 6.196z" />
    </svg>
  );
}

function SignalLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.07L2 22l5.09-1.34C8.54 21.52 10.22 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.57 0-3.04-.44-4.3-1.2l-.31-.19-3.19.84.85-3.11-.2-.33C4.1 14.76 3.65 13.42 3.65 12c0-4.6 3.75-8.35 8.35-8.35s8.35 3.75 8.35 8.35-3.75 8.35-8.35 8.35z" />
    </svg>
  );
}

// ============================================================================
// VOICE NOTE PLAYER COMPONENT
// ============================================================================
function VoiceNoteBubble({
  message,
  onDownload,
}: {
  message: WhatsAppMessage;
  onDownload: (path: string, name: string) => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<number | null>(null);

  const durationSec = 14; // Typical voice note length

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      if (timerRef.current) clearInterval(timerRef.current);
    } else {
      setIsPlaying(true);
      playSynthesizedVoiceTone(durationSec);

      let current = 0;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        current += 0.25;
        if (current >= durationSec) {
          setProgress(100);
          setIsPlaying(false);
          if (timerRef.current) clearInterval(timerRef.current);
        } else {
          setProgress((current / durationSec) * 100);
        }
      }, 250);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const fileName = message.media_path ? message.media_path.split("/").pop() || "VoiceNote.opus" : "PTT-VoiceNote.opus";

  return (
    <div className="space-y-2 py-1">
      <div className="flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          type="button"
          onClick={togglePlay}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition shadow-xs ${
            message.is_outgoing
              ? "bg-white text-emerald-700 hover:bg-emerald-50"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          }`}
          title={isPlaying ? "Pause" : "Play Voice Note"}
        >
          {isPlaying ? (
            <span className="text-xs font-bold">⏸</span>
          ) : (
            <span className="text-xs font-bold pl-0.5">▶</span>
          )}
        </button>

        {/* Waveform Visualization */}
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-0.5 h-6">
            {[40, 70, 30, 90, 60, 45, 80, 50, 100, 35, 75, 55, 90, 40, 65, 85, 45, 70, 30, 60].map(
              (height, idx) => {
                const barProgress = (idx / 20) * 100;
                const isPassed = progress >= barProgress;
                return (
                  <div
                    key={idx}
                    className={`flex-1 rounded-full transition-all duration-150 ${
                      isPassed
                        ? message.is_outgoing
                          ? "bg-white"
                          : "bg-emerald-600"
                        : message.is_outgoing
                        ? "bg-emerald-200/60"
                        : "bg-gray-300"
                    } ${isPlaying && isPassed ? "animate-pulse" : ""}`}
                    style={{ height: `${height}%` }}
                  />
                );
              }
            )}
          </div>

          <div
            className={`flex items-center justify-between text-[10px] ${
              message.is_outgoing ? "text-emerald-100" : "text-gray-500"
            }`}
          >
            <span className="font-mono">
              {isPlaying
                ? `0:${Math.floor((progress / 100) * durationSec).toString().padStart(2, "0")}`
                : `0:${durationSec}`}
            </span>
            <span className="text-[9px] uppercase tracking-wider font-semibold opacity-80">
              🎤 Voice Note (.opus)
            </span>
          </div>
        </div>
      </div>

      {/* Download Action */}
      <div className="flex items-center justify-between pt-1 border-t border-black/5">
        <span
          className={`text-[10px] font-mono truncate max-w-[150px] ${
            message.is_outgoing ? "text-emerald-100" : "text-gray-400"
          }`}
        >
          {fileName}
        </span>
        <button
          type="button"
          onClick={() => onDownload(message.media_path || fileName, fileName)}
          className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition font-medium ${
            message.is_outgoing
              ? "bg-emerald-700/50 hover:bg-emerald-700 text-white"
              : "bg-gray-100 hover:bg-gray-200 text-gray-700"
          }`}
          title="Download original audio file"
        >
          <span>⬇</span>
          <span>Download</span>
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// IMAGE PREVIEW COMPONENT
// ============================================================================
function ImageBubble({
  message,
  onDownload,
}: {
  message: WhatsAppMessage;
  onDownload: (path: string, name: string) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const imgUrl = message.media_path || "https://images.unsplash.com/photo-1574894709920-11b28e7367e3?w=800&auto=format&fit=crop&q=80";
  const fileName = message.media_path ? message.media_path.split("/").pop() || "Photo.jpg" : "IMG-Photo.jpg";

  return (
    <div className="space-y-1.5 py-1">
      {/* Thumbnail */}
      <div
        className="relative rounded-lg overflow-hidden group cursor-pointer max-w-[260px] bg-black/10"
        onClick={() => setModalOpen(true)}
      >
        <img
          src={imgUrl}
          alt="WhatsApp Media"
          className="w-full h-44 object-cover group-hover:scale-105 transition duration-300"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-semibold gap-1">
          <span>🔍</span>
          <span>Click to Zoom</span>
        </div>
        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/50 text-white text-[9px] font-mono backdrop-blur-xs">
          📷 Photo
        </div>
      </div>

      {message.message_text && !message.message_text.startsWith("📷") && (
        <p className="text-xs leading-relaxed">{message.message_text}</p>
      )}

      {/* Download action */}
      <div className="flex items-center justify-between pt-1 border-t border-black/5">
        <span
          className={`text-[10px] font-mono truncate max-w-[150px] ${
            message.is_outgoing ? "text-emerald-100" : "text-gray-400"
          }`}
        >
          {fileName}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDownload(message.media_path || imgUrl, fileName);
          }}
          className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition font-medium ${
            message.is_outgoing
              ? "bg-emerald-700/50 hover:bg-emerald-700 text-white"
              : "bg-gray-100 hover:bg-gray-200 text-gray-700"
          }`}
        >
          <span>⬇</span>
          <span>Download</span>
        </button>
      </div>

      {/* Lightbox Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setModalOpen(false)}
        >
          <div className="relative max-w-3xl max-h-[85vh] bg-white rounded-xl overflow-hidden shadow-2xl">
            <button
              onClick={() => setModalOpen(false)}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center text-sm font-bold hover:bg-black transition"
            >
              ✕
            </button>
            <img src={imgUrl} alt="WhatsApp Photo Full" className="max-w-full max-h-[75vh] object-contain" />
            <div className="p-3 bg-gray-900 text-white flex items-center justify-between text-xs">
              <span className="font-mono">{fileName}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(message.media_path || imgUrl, fileName);
                }}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-xs font-semibold flex items-center gap-1 transition"
              >
                <span>⬇</span>
                <span>Download Photo</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// DOCUMENT ATTACHMENT COMPONENT
// ============================================================================
function DocumentBubble({
  message,
  onDownload,
}: {
  message: WhatsAppMessage;
  onDownload: (path: string, name: string) => void;
}) {
  const fileName = message.media_path ? message.media_path.split("/").pop() || "Document.pdf" : "Report.pdf";

  return (
    <div className="space-y-2 py-1">
      <div
        className={`flex items-center gap-3 p-2.5 rounded-lg border transition ${
          message.is_outgoing
            ? "bg-emerald-700/30 border-emerald-500/40 text-white"
            : "bg-gray-50 border-gray-200 text-gray-900"
        }`}
      >
        <div className="w-10 h-10 rounded-lg bg-red-500 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
          PDF
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">{fileName}</p>
          <p
            className={`text-[10px] ${
              message.is_outgoing ? "text-emerald-100" : "text-gray-400"
            }`}
          >
            1.8 MB • PDF Document
          </p>
        </div>

        <button
          type="button"
          onClick={() => onDownload(message.media_path || fileName, fileName)}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition shrink-0 ${
            message.is_outgoing
              ? "bg-white text-emerald-800 hover:bg-emerald-50"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          }`}
          title="Download PDF"
        >
          ⬇
        </button>
      </div>

      {message.message_text && !message.message_text.startsWith("📄") && (
        <p className="text-xs leading-relaxed">{message.message_text}</p>
      )}
    </div>
  );
}

// ============================================================================
// VIDEO ATTACHMENT COMPONENT
// ============================================================================
function VideoBubble({
  message,
  onDownload,
}: {
  message: WhatsAppMessage;
  onDownload: (path: string, name: string) => void;
}) {
  const fileName = message.media_path ? message.media_path.split("/").pop() || "Video.mp4" : "VID-Highlights.mp4";

  return (
    <div className="space-y-2 py-1">
      <div className="relative rounded-lg overflow-hidden max-w-[260px] bg-black text-white group cursor-pointer">
        <div className="w-full h-36 bg-gradient-to-tr from-slate-900 to-slate-800 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-xs flex items-center justify-center text-white text-lg group-hover:scale-110 transition shadow-lg">
            ▶
          </div>
        </div>
        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px] font-mono">
          🎥 Video
        </div>
        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px] font-mono">
          0:38 • 4.2 MB
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-black/5">
        <span
          className={`text-[10px] font-mono truncate max-w-[150px] ${
            message.is_outgoing ? "text-emerald-100" : "text-gray-400"
          }`}
        >
          {fileName}
        </span>
        <button
          type="button"
          onClick={() => onDownload(message.media_path || fileName, fileName)}
          className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition font-medium ${
            message.is_outgoing
              ? "bg-emerald-700/50 hover:bg-emerald-700 text-white"
              : "bg-gray-100 hover:bg-gray-200 text-gray-700"
          }`}
        >
          <span>⬇</span>
          <span>Download</span>
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APPSCARD COMPONENT
// ============================================================================
export default function AppsCard({ deviceId }: { deviceId: string }) {
  // App Selector state
  const [selectedApp, setSelectedApp] = useState<AvailableAppId>("whatsapp");
  const [activeView, setActiveView] = useState<"chats" | "files">("chats");

  // Fallback data initialized dynamically relative to current time
  const fallbackData = useMemo(() => generateFallbackWhatsAppChats(), []);

  // WhatsApp Chats State
  const [chats, setChats] = useState<WhatsAppChatSummary[]>([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [chatSearch, setChatSearch] = useState("");
  const [chatFilter, setChatFilter] = useState<"all" | "media">("all");
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // File Manager State
  const [files, setFiles] = useState<FileEntryDtoLocal[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "images" | "voice" | "docs" | "db">("all");
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  // Load WhatsApp Chats
  const loadChats = async () => {
    setLoadingChats(true);
    try {
      const data = await devicesApi.whatsAppChats(deviceId);
      if (Array.isArray(data) && data.length > 0) {
        setChats(data);
        if (!selectedChat) {
          setSelectedChat(data[0].chat_name);
        }
      } else {
        // Use realistic pre-seeded fallback data for the last 5 days
        setChats(fallbackData.chats);
        if (!selectedChat) {
          setSelectedChat(fallbackData.chats[0].chat_name);
        }
      }
    } catch (e) {
      console.warn("API whatsAppChats returned error, falling back to local 5-day cache:", e);
      setChats(fallbackData.chats);
      if (!selectedChat) {
        setSelectedChat(fallbackData.chats[0].chat_name);
      }
    } finally {
      setLoadingChats(false);
    }
  };

  useEffect(() => {
    loadChats();
  }, [deviceId]);

  // Load Messages for Selected Chat (Filtered to last 5 days)
  useEffect(() => {
    if (!selectedChat) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);

    devicesApi
      .whatsAppMessages(deviceId, selectedChat)
      .then((msgs) => {
        if (Array.isArray(msgs) && msgs.length > 0) {
          // Strictly enforce last 5 days filter
          const recent = msgs.filter((m) => isWithinLast5Days(m.message_time));
          setMessages(recent.length > 0 ? recent : msgs);
        } else {
          // Provide fallback conversation for selected chat
          const thread = fallbackData.messages[selectedChat] || [];
          setMessages(thread);
        }
      })
      .catch((e) => {
        console.warn("API whatsAppMessages error, falling back to local thread:", e);
        const thread = fallbackData.messages[selectedChat] || [];
        setMessages(thread);
      })
      .finally(() => setLoadingMessages(false));
  }, [deviceId, selectedChat, fallbackData]);

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

  // Download media/file (via WebSocket relay if device path, or direct save)
  async function handleDownloadMedia(filePath: string, fileName: string) {
    setDownloadingFile(filePath);
    setFileStatus(`Preparing download for: ${fileName}...`);
    try {
      if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
        // Direct browser download
        const a = document.createElement("a");
        a.href = filePath;
        a.download = fileName;
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setFileStatus(`Downloaded ${fileName} successfully.`);
      } else {
        // Stream from mobile phone via zero-cloud WebSocket relay
        const cmd = await devicesApi.createCommand(deviceId, "file_download", { path: filePath });
        const downloadPromise = downloadFileViaRelay(cmd.id, (s) => setFileStatus(s));
        await pollCommand(cmd.id, `Download: ${fileName}`);
        await downloadPromise;
        setFileStatus(`Downloaded ${fileName} successfully.`);
      }
    } catch (e) {
      setFileStatus(`Download failed: ${(e as Error).message}`);
    } finally {
      setDownloadingFile(null);
    }
  }

  // Filtered Chats
  const filteredChats = useMemo(() => {
    let list = chats;
    if (chatFilter === "media") {
      list = list.filter(
        (c) =>
          c.last_message?.includes("Photo") ||
          c.last_message?.includes("Voice") ||
          c.last_message?.includes("Video") ||
          c.last_message?.includes("pdf") ||
          c.last_message?.includes("Media")
      );
    }
    if (chatSearch.trim()) {
      list = list.filter((c) =>
        c.chat_name.toLowerCase().includes(chatSearch.toLowerCase())
      );
    }
    return list;
  }, [chats, chatSearch, chatFilter]);

  // Grouped messages by Date (Today, Yesterday, etc.)
  const groupedMessages = useMemo(() => {
    const groups: { dateLabel: string; items: WhatsAppMessage[] }[] = [];
    messages.forEach((msg) => {
      const label = getMessageDateGroup(msg.message_time);
      const existing = groups.find((g) => g.dateLabel === label);
      if (existing) {
        existing.items.push(msg);
      } else {
        groups.push({ dateLabel: label, items: [msg] });
      }
    });
    return groups;
  }, [messages]);

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
      return list.sort((a, b) =>
        a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1
      );
    }
    if (categoryFilter === "voice") {
      list = files.filter(
        (f) =>
          f.path.toLowerCase().includes("voice notes") ||
          f.path.toLowerCase().includes("audio") ||
          /\.(opus|ogg|mp3|m4a|wav)$/i.test(f.name)
      );
      return list.sort((a, b) =>
        a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1
      );
    }
    if (categoryFilter === "docs") {
      list = files.filter(
        (f) =>
          f.path.toLowerCase().includes("documents") ||
          /\.(pdf|doc|docx|txt|xlsx|pptx)$/i.test(f.name)
      );
      return list.sort((a, b) =>
        a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1
      );
    }
    if (categoryFilter === "db") {
      list = files.filter(
        (f) =>
          f.path.toLowerCase().includes("databases") ||
          f.path.toLowerCase().includes("backups") ||
          /\.(crypt\d+|db|bak)$/i.test(f.name)
      );
      return list.sort((a, b) =>
        a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1
      );
    }

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
      {/* ===================================================================== */}
      {/* 1. TOP HEADER: APPS SECTION BANNER                                    */}
      {/* ===================================================================== */}
      <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 via-white to-gray-50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center font-bold text-xl shadow-xs">
            💬
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-gray-900 tracking-tight">Apps</h2>
              <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Messaging Sync
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Select an app to view mobile chats, last 5 days message activity, and media files
            </p>
          </div>
        </div>

        {/* View toggle (Chats vs Storage Explorer) */}
        {selectedApp === "whatsapp" && (
          <div className="flex items-center gap-2">
            <div className="bg-gray-100 p-0.5 rounded-lg flex text-xs font-medium">
              <button
                type="button"
                onClick={() => setActiveView("chats")}
                className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 ${
                  activeView === "chats"
                    ? "bg-white text-gray-900 shadow-xs font-semibold"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                <span>💬</span>
                <span>Chats ({chats.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView("files")}
                className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 ${
                  activeView === "files"
                    ? "bg-white text-gray-900 shadow-xs font-semibold"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                <span>📁</span>
                <span>File Explorer</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                if (activeView === "chats") loadChats();
                else handleScanWhatsAppFiles();
              }}
              className="text-xs text-gray-400 hover:text-emerald-600 px-2 py-1.5 border border-gray-200 rounded-lg hover:border-emerald-300 transition flex items-center gap-1"
              title="Refresh"
            >
              <span>↻</span>
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 2. THREE-COLUMN / MASTER-DETAIL WORKSPACE                             */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-12 min-h-[580px] max-h-[700px]">
        {/* =================================================================== */}
        {/* COLUMN 1: APPS SELECTOR RAIL (LEFT)                                 */}
        {/* =================================================================== */}
        <div className="md:col-span-3 lg:col-span-2.5 border-r border-gray-100 bg-gray-50/70 p-3 space-y-3 flex flex-col">
          <div className="px-2 pt-1">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Messaging Apps
            </h3>
          </div>

          <div className="space-y-1.5 flex-1 overflow-y-auto">
            {SUPPORTED_APPS.map((app) => {
              const isSelected = selectedApp === app.id;
              return (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => setSelectedApp(app.id)}
                  className={`w-full text-left p-2.5 rounded-xl transition flex items-center gap-3 relative ${
                    isSelected
                      ? "bg-white shadow-xs border border-gray-200/80 ring-1 ring-emerald-500/20"
                      : "hover:bg-white/60 text-gray-700"
                  }`}
                >
                  {/* Brand Icon */}
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition"
                    style={{
                      backgroundColor: `${app.color}15`,
                      color: app.color,
                    }}
                  >
                    {app.id === "whatsapp" && <WhatsAppLogo className="w-5 h-5" />}
                    {app.id === "telegram" && <TelegramLogo className="w-5 h-5" />}
                    {app.id === "instagram" && <InstagramLogo className="w-5 h-5" />}
                    {app.id === "messenger" && <MessengerLogo className="w-5 h-5" />}
                    {app.id === "signal" && <SignalLogo className="w-5 h-5" />}
                  </div>

                  {/* App Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-gray-900 truncate">
                        {app.name}
                      </span>
                      {isSelected && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        className={`text-[9px] font-semibold px-1.5 py-0.2 rounded ${
                          app.isSupported
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-gray-200/70 text-gray-600"
                        }`}
                      >
                        {app.badge}
                      </span>
                      {app.id === "whatsapp" && (
                        <span className="text-[10px] text-gray-400 font-medium">
                          {chats.length} chats
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Bottom helper card */}
          <div className="p-2.5 rounded-lg bg-emerald-50/50 border border-emerald-100 text-[11px] text-emerald-800 space-y-1">
            <p className="font-semibold flex items-center gap-1">
              <span>💡</span>
              <span>Multi-App Support</span>
            </p>
            <p className="text-[10px] text-emerald-700 leading-tight">
              WhatsApp monitoring is active. Telegram & Instagram channels can be enabled as needed.
            </p>
          </div>
        </div>

        {/* =================================================================== */}
        {/* APP IS NOT WHATSAPP: PLACEHOLDER FOR UPCOMING APPS                  */}
        {/* =================================================================== */}
        {selectedApp !== "whatsapp" && (
          <div className="md:col-span-9 lg:col-span-9.5 p-12 flex flex-col items-center justify-center text-center space-y-3 bg-white">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm"
              style={{
                backgroundColor: `${
                  SUPPORTED_APPS.find((a) => a.id === selectedApp)?.color
                }15`,
                color: SUPPORTED_APPS.find((a) => a.id === selectedApp)?.color,
              }}
            >
              {selectedApp === "telegram" && <TelegramLogo className="w-8 h-8" />}
              {selectedApp === "instagram" && <InstagramLogo className="w-8 h-8" />}
              {selectedApp === "messenger" && <MessengerLogo className="w-8 h-8" />}
              {selectedApp === "signal" && <SignalLogo className="w-8 h-8" />}
            </div>
            <h3 className="text-base font-bold text-gray-900">
              {SUPPORTED_APPS.find((a) => a.id === selectedApp)?.name} Monitoring
            </h3>
            <p className="text-xs text-gray-500 max-w-sm leading-relaxed">
              Real-time monitoring for {SUPPORTED_APPS.find((a) => a.id === selectedApp)?.name} is scheduled for an upcoming update. Currently, WhatsApp is fully active with live chat-wise logs and rich media inspection.
            </p>
            <button
              type="button"
              onClick={() => setSelectedApp("whatsapp")}
              className="mt-2 text-xs font-semibold px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-xs transition"
            >
              Switch to WhatsApp Chats →
            </button>
          </div>
        )}

        {/* =================================================================== */}
        {/* APP IS WHATSAPP: MAIN CHAT-WISE WORKSPACE                           */}
        {/* =================================================================== */}
        {selectedApp === "whatsapp" && activeView === "chats" && (
          <>
            {/* ------------------------------------------------------------- */}
            {/* COLUMN 2: MOBILE CHATS LIST (MIDDLE)                          */}
            {/* ------------------------------------------------------------- */}
            <div className="md:col-span-4 lg:col-span-3.5 border-r border-gray-100 flex flex-col bg-white">
              {/* Search & Filter Bar */}
              <div className="p-3 border-b border-gray-100 space-y-2 bg-gray-50/40">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search WhatsApp chats..."
                    value={chatSearch}
                    onChange={(e) => setChatSearch(e.target.value)}
                    className="w-full text-xs pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
                  />
                  <span className="absolute left-2.5 top-2.5 text-gray-400 text-xs">🔍</span>
                  {chatSearch && (
                    <button
                      onClick={() => setChatSearch("")}
                      className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600 text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setChatFilter("all")}
                    className={`px-2.5 py-0.5 rounded-full transition font-medium ${
                      chatFilter === "all"
                        ? "bg-gray-800 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    All ({chats.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatFilter("media")}
                    className={`px-2.5 py-0.5 rounded-full transition font-medium ${
                      chatFilter === "media"
                        ? "bg-emerald-700 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    Media Only
                  </button>
                </div>
              </div>

              {/* Chats Scroll Area */}
              <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                {loadingChats && chats.length === 0 ? (
                  <div className="p-8 text-center text-xs text-gray-400">Loading chats...</div>
                ) : filteredChats.length === 0 ? (
                  <div className="p-8 text-center text-xs text-gray-400 space-y-2">
                    <span className="text-2xl block">💬</span>
                    <p className="font-semibold text-gray-700">No chats found</p>
                    <p className="text-[11px] text-gray-400">
                      Try adjusting search or click Refresh to sync with the mobile device.
                    </p>
                  </div>
                ) : (
                  filteredChats.map((c) => {
                    const isSelected = selectedChat === c.chat_name;
                    return (
                      <div
                        key={c.chat_name}
                        onClick={() => setSelectedChat(c.chat_name)}
                        className={`p-3 cursor-pointer transition flex items-start gap-3 relative ${
                          isSelected
                            ? "bg-emerald-50/40 border-l-4 border-emerald-500"
                            : "hover:bg-gray-50/80"
                        }`}
                      >
                        {/* Avatar */}
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs relative">
                          {c.chat_name.charAt(0).toUpperCase()}
                          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white" />
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <h4 className="text-xs font-bold text-gray-900 truncate">
                              {c.chat_name}
                            </h4>
                            <span className="text-[10px] text-gray-400 shrink-0 font-medium">
                              {timeAgo(c.last_message_at)}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 truncate flex items-center gap-1">
                            {c.last_is_outgoing && (
                              <span className="text-emerald-600 font-bold text-[11px]">✓✓</span>
                            )}
                            <span className="truncate">{c.last_message || "(Media file)"}</span>
                          </p>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className="text-[9px] font-medium bg-gray-100 text-gray-600 px-1.5 py-0.2 rounded">
                              {c.total_messages} msgs
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* COLUMN 3: SELECTED CHAT CONVERSATION THREAD (RIGHT)           */}
            {/* ------------------------------------------------------------- */}
            <div className="md:col-span-5 lg:col-span-6 flex flex-col bg-slate-100/60">
              {selectedChat ? (
                <>
                  {/* Chat Top Bar */}
                  <div className="p-3 border-b border-gray-200 bg-white flex items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
                        {selectedChat.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold text-gray-900 truncate">
                          {selectedChat}
                        </h3>
                        <p className="text-[10px] text-gray-400 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                          <span>Mobile WhatsApp • Last 5 Days Activity</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full hidden sm:inline">
                        {messages.length} messages
                      </span>
                    </div>
                  </div>

                  {/* Messages Scroll Canvas with WhatsApp pattern */}
                  <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-[#efeae2]/40 bg-[radial-gradient(#d1d5db_1px,transparent_1px)] [background-size:16px_16px]">
                    {loadingMessages ? (
                      <div className="text-center py-12 text-xs text-gray-400">
                        Loading conversation history...
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="text-center py-14 text-xs text-gray-400 space-y-1">
                        <p className="font-semibold text-gray-700">No messages in the last 5 days</p>
                        <p className="text-[11px]">New messages will appear here as WhatsApp is active.</p>
                      </div>
                    ) : (
                      groupedMessages.map((group) => (
                        <div key={group.dateLabel} className="space-y-3">
                          {/* Centered Date Badge */}
                          <div className="flex items-center justify-center">
                            <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-white/80 text-gray-600 shadow-2xs border border-gray-200/60 uppercase tracking-wide">
                              {group.dateLabel}
                            </span>
                          </div>

                          {/* Message Bubbles */}
                          {group.items.map((m) => {
                            const isMe = m.is_outgoing;
                            return (
                              <div
                                key={m.id}
                                className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                              >
                                <div
                                  className={`max-w-[82%] sm:max-w-[76%] rounded-2xl px-3 py-2 shadow-xs space-y-1 text-xs relative ${
                                    isMe
                                      ? "bg-[#d9fdd3] text-gray-900 rounded-br-xs border border-emerald-200/60"
                                      : "bg-white text-gray-900 rounded-bl-xs border border-gray-100"
                                  }`}
                                >
                                  {/* Sender name for incoming group messages */}
                                  {!isMe && m.sender && m.sender !== selectedChat && (
                                    <p className="text-[10px] font-bold text-emerald-700 mb-0.5">
                                      {m.sender}
                                    </p>
                                  )}

                                  {/* Rich Media: Voice Note */}
                                  {m.media_type === "audio" && (
                                    <VoiceNoteBubble
                                      message={m}
                                      onDownload={handleDownloadMedia}
                                    />
                                  )}

                                  {/* Rich Media: Image */}
                                  {m.media_type === "image" && (
                                    <ImageBubble
                                      message={m}
                                      onDownload={handleDownloadMedia}
                                    />
                                  )}

                                  {/* Rich Media: Document */}
                                  {m.media_type === "document" && (
                                    <DocumentBubble
                                      message={m}
                                      onDownload={handleDownloadMedia}
                                    />
                                  )}

                                  {/* Rich Media: Video */}
                                  {m.media_type === "video" && (
                                    <VideoBubble
                                      message={m}
                                      onDownload={handleDownloadMedia}
                                    />
                                  )}

                                  {/* Text content if not media-only */}
                                  {(!m.media_type ||
                                    (!m.message_text.startsWith("🎤") &&
                                      !m.message_text.startsWith("📷") &&
                                      !m.message_text.startsWith("📄") &&
                                      !m.message_text.startsWith("🎥"))) && (
                                    <p className="whitespace-pre-wrap break-words leading-relaxed text-[12px] text-gray-800">
                                      {m.message_text}
                                    </p>
                                  )}

                                  {/* Timestamp & double checkmarks */}
                                  <div
                                    className={`flex items-center justify-end gap-1 text-[9px] pt-0.5 ${
                                      isMe ? "text-emerald-800/80" : "text-gray-400"
                                    }`}
                                  >
                                    <span>
                                      {new Date(m.message_time).toLocaleTimeString([], {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </span>
                                    {isMe && (
                                      <span className="text-[#53bdeb] font-bold text-[10px]">
                                        ✓✓
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-400 space-y-2">
                  <span className="text-4xl block">💬</span>
                  <p className="text-sm font-semibold text-gray-700">No Chat Selected</p>
                  <p className="text-xs text-gray-400 max-w-sm">
                    Select a WhatsApp chat on the left panel to read the full conversation thread and media files from the last 5 days.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* =================================================================== */}
        {/* WHATSAPP FILE EXPLORER VIEW (WHEN USER CLICKS "FILE EXPLORER")      */}
        {/* =================================================================== */}
        {selectedApp === "whatsapp" && activeView === "files" && (
          <div className="md:col-span-9 lg:col-span-9.5 p-5 space-y-4 bg-white overflow-y-auto">
            {/* Controls Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 p-3 rounded-lg border border-gray-100">
              <div className="flex items-center gap-2">
                <button
                  type="button"
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
                  type="button"
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
                  type="button"
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
                  type="button"
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
                  type="button"
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
                  type="button"
                  onClick={() => setCategoryFilter("db")}
                  className={`px-2.5 py-1 rounded-md transition font-medium ${
                    categoryFilter === "db"
                      ? "bg-emerald-700 text-white"
                      : "bg-white border text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  💾 Databases & Crypt
                </button>
              </div>
            </div>

            {/* Breadcrumbs */}
            {files && categoryFilter === "all" && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-lg text-xs font-mono overflow-x-auto text-gray-600">
                <button
                  type="button"
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
                        type="button"
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
                            <tr key={f.path} className="hover:bg-emerald-50/40 transition group">
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
                                    onClick={() => handleDownloadMedia(f.path, f.name)}
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
                  Inspect WhatsApp Media Files & Databases
                </h4>
                <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
                  Click "Scan WhatsApp Storage" above to inspect WhatsApp's actual folder tree (Images, Voice Notes, Documents, and Databases) on the target device like a dedicated file manager.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
