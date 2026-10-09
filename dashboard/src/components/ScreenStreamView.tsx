import { useEffect, useRef, useState } from "react";
import { WS_BASE_URL } from "../api/client";
import { devicesApi } from "../api/devices";

interface ScreenStreamViewProps {
  deviceId: string;
  deviceName?: string;
  isStandalone?: boolean;
  onClose?: () => void;
  onPopOut?: () => void;
}

type StreamStatus =
  | "initializing"
  | "connecting_ws"
  | "waiting_device"
  | "streaming"
  | "paused"
  | "stopped"
  | "error";

export default function ScreenStreamView({
  deviceId,
  deviceName,
  isStandalone = false,
  onClose,
  onPopOut,
}: ScreenStreamViewProps) {
  const [status, setStatus] = useState<StreamStatus>("initializing");
  const [statusMessage, setStatusMessage] = useState<string>("Initializing stream session...");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [frameCount, setFrameCount] = useState<number>(0);
  const [streamDuration, setStreamDuration] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [screenResolution, setScreenResolution] = useState<string | null>(null);
  const [hasAudioStream, setHasAudioStream] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const frameTimestampsRef = useRef<number[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Audio Context & scheduler refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextAudioTimeRef = useRef<number>(0);
  const isMutedRef = useRef<boolean>(false);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Duration timer
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (status === "streaming") {
      interval = setInterval(() => {
        setStreamDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status]);

  // FPS calculation cleaner (removes timestamps older than 1 second)
  useEffect(() => {
    const fpsInterval = setInterval(() => {
      const now = Date.now();
      frameTimestampsRef.current = frameTimestampsRef.current.filter((t) => now - t <= 1000);
      setFps(frameTimestampsRef.current.length);
    }, 500);

    return () => clearInterval(fpsInterval);
  }, []);

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx({ sampleRate: 16000 });
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  };

  const playPcmAudio = (pcmBytes: Uint8Array) => {
    if (isMutedRef.current) return;
    try {
      const ctx = getAudioContext();
      const int16 = new Int16Array(
        pcmBytes.buffer,
        pcmBytes.byteOffset,
        pcmBytes.byteLength / 2
      );
      const numSamples = int16.length;
      if (numSamples === 0) return;

      const float32 = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      const buffer = ctx.createBuffer(1, numSamples, 16000);
      buffer.copyToChannel(float32, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const currentTime = ctx.currentTime;
      if (nextAudioTimeRef.current < currentTime) {
        nextAudioTimeRef.current = currentTime + 0.04; // 40ms safety offset
      }
      source.start(nextAudioTimeRef.current);
      nextAudioTimeRef.current += buffer.duration;
    } catch (e) {
      console.warn("PCM audio decode error", e);
    }
  };

  const startStream = () => {
    // 1. Cleanup any existing WS
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    setStatus("connecting_ws");
    setStatusMessage("Connecting to live stream pipe...");

    const token = localStorage.getItem("spapp_token") || "";
    if (!token) {
      setStatus("error");
      setStatusMessage("Admin authentication missing. Please log in again.");
      return;
    }

    // 2. Open WebSocket IMMEDIATELY without waiting for HTTP POST
    const wsUrl = `${WS_BASE_URL}/ws/screen-stream?role=admin&token=${encodeURIComponent(
      token
    )}&deviceId=${encodeURIComponent(deviceId)}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMountedRef.current) return;
      setStatus("waiting_device");
      setStatusMessage("Relay connected. Waiting for phone frames...");
    };

    // 3. Concurrently dispatch wake command to device
    devicesApi
      .createCommand(deviceId, "screen_stream", { action: "start" })
      .then((cmd) => {
        if (!isMountedRef.current) return;
        if (cmd.push && !cmd.push.sent) {
          setStatusMessage(
            `Wake queued (${cmd.push.reason || "push delayed"}). Awaiting device stream...`
          );
        } else {
          setStatusMessage("Wake signal delivered. Initializing video pipe...");
        }
      })
      .catch((e) => {
        console.warn("Failed to send screen_stream wake command:", e);
      });

    ws.onmessage = (event) => {
      if (!isMountedRef.current) return;

      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "status") {
            if (msg.status === "streaming") {
              setStatus("streaming");
              setStatusMessage("Live screen stream active");
            } else if (msg.status === "waiting_device") {
              setStatus("waiting_device");
              setStatusMessage("Waiting for device screen stream...");
            } else if (msg.status === "device_stopped") {
              setStatus("stopped");
              setStatusMessage("Device stopped streaming");
            }
          }
        } catch {
          // ignore
        }
      } else if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        if (bytes.length < 2) return;

        // Packet Type Routing:
        // 0x01: Video JPEG frame
        // 0x02: Audio PCM 16kHz mono chunk
        // 0xFF, 0xD8: Legacy raw JPEG frame
        if (bytes[0] === 0x01 || (bytes[0] === 0xff && bytes[1] === 0xd8)) {
          const jpegBytes = bytes[0] === 0x01 ? bytes.subarray(1) : bytes;
          const blob = new Blob([jpegBytes], { type: "image/jpeg" });
          const newUrl = URL.createObjectURL(blob);

          if (currentUrlRef.current) {
            URL.revokeObjectURL(currentUrlRef.current);
          }
          currentUrlRef.current = newUrl;
          setFrameUrl(newUrl);

          frameTimestampsRef.current.push(Date.now());
          setFrameCount((prev) => prev + 1);

          setStatus((prev) => (prev !== "streaming" ? "streaming" : prev));
          setStatusMessage("Live stream active");
        } else if (bytes[0] === 0x02) {
          setHasAudioStream(true);
          playPcmAudio(bytes.subarray(1));
        }
      }
    };

    ws.onerror = (err) => {
      console.error("Screen stream WebSocket error:", err);
      if (!isMountedRef.current) return;
      setStatus("error");
      setStatusMessage("Connection error with screen relay.");
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;
      if (status !== "stopped") {
        setStatus("stopped");
        setStatusMessage("Screen stream session closed.");
      }
    };
  };

  const stopStream = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ action: "stop" }));
        wsRef.current.close();
      } catch {
        // ignore
      }
    }
    wsRef.current = null;
    setStatus("stopped");
    setStatusMessage("Screen stream stopped by administrator.");

    // Also send stop remote command in case socket is already closed
    devicesApi
      .createCommand(deviceId, "screen_stream", { action: "stop" })
      .catch(() => {});
  };

  const handleSnapshot = () => {
    if (!frameUrl) return;
    const a = document.createElement("a");
    a.href = frameUrl;
    const dateStr = new Date().toISOString().replace(/[:.]/g, "-");
    a.download = `spapp-screen-${deviceName || deviceId}-${dateStr}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    startStream();

    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      isMountedRef.current = false;
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (wsRef.current) {
        try {
          wsRef.current.send(JSON.stringify({ action: "stop" }));
          wsRef.current.close();
        } catch {
          // ignore
        }
      }
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
      }
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch {
          // ignore
        }
      }
    };
  }, [deviceId]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      ref={containerRef}
      className={`flex flex-col items-center justify-between bg-slate-950 text-slate-100 select-none ${
        isStandalone ? "min-h-screen p-4 sm:p-6" : "p-4 w-full"
      }`}
    >
      {/* Top Header Bar */}
      <div className="w-full max-w-md flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            <span
              className={`w-3 h-3 rounded-full ${
                status === "streaming"
                  ? "bg-emerald-500 animate-ping absolute opacity-75"
                  : status === "waiting_device"
                  ? "bg-amber-400 animate-pulse absolute opacity-75"
                  : "bg-slate-600"
              }`}
            />
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                status === "streaming"
                  ? "bg-emerald-500"
                  : status === "waiting_device"
                  ? "bg-amber-400"
                  : "bg-slate-500"
              }`}
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
              <span>{deviceName || "Target Device"}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wider">
                {status === "streaming" ? "LIVE" : status}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400 truncate max-w-[220px]">
              {statusMessage}
            </p>
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1.5">
          {!isStandalone && onPopOut && (
            <button
              onClick={onPopOut}
              title="Pop out to separate window"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          )}

          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isFullscreen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              )}
            </svg>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              title="Close Stream"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Stream Metrics Pills */}
      <div className="w-full max-w-md flex items-center justify-between text-[11px] font-mono text-slate-400 bg-slate-900/90 rounded-lg px-3 py-1.5 mb-3 border border-slate-800/60">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-1">
            <span className="text-slate-500">FPS:</span>
            <span className={`font-semibold ${fps > 0 ? "text-emerald-400" : "text-slate-400"}`}>
              {fps.toFixed(1)}
            </span>
          </span>
          <span className="text-slate-700">|</span>
          <span className="flex items-center gap-1">
            <span className="text-slate-500">TIME:</span>
            <span className="text-slate-300 font-semibold">{formatTimer(streamDuration)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          {hasAudioStream && (
            <>
              <span className={`flex items-center gap-1 ${isMuted ? "text-amber-400" : "text-emerald-400"}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                <span>{isMuted ? "MUTED" : "AUDIO"}</span>
              </span>
              <span className="text-slate-700">|</span>
            </>
          )}
          {screenResolution && (
            <>
              <span className="text-slate-300">{screenResolution}</span>
              <span className="text-slate-700">|</span>
            </>
          )}
          <span className="text-slate-400">{frameCount} frames</span>
        </div>
      </div>

      {/* Mobile Device Frame Chassis */}
      <div className="relative w-full max-w-[340px] sm:max-w-[360px] aspect-[9/18.5] bg-slate-900 rounded-[44px] p-2.5 sm:p-3 shadow-2xl shadow-black/90 border-[4px] border-slate-800/90 flex flex-col items-center justify-center">
        {/* Top Speaker & Camera Cutout Notch */}
        <div className="absolute top-2.5 z-20 flex items-center justify-center gap-2 px-3 py-0.5 rounded-full bg-slate-950/80 border border-slate-800/50 backdrop-blur-sm">
          <div className="w-2.5 h-2.5 rounded-full bg-slate-800 border border-slate-700/60 flex items-center justify-center">
            <div className="w-1 h-1 rounded-full bg-sky-950" />
          </div>
          <div className="w-8 h-1 rounded-full bg-slate-800" />
        </div>

        {/* Device Screen Viewport */}
        <div className="w-full h-full bg-black rounded-[34px] overflow-hidden relative flex items-center justify-center">
          {frameUrl ? (
            <img
              src={frameUrl}
              alt="Device Screen Stream"
              className="w-full h-full object-contain select-none"
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) {
                  setScreenResolution(`${img.naturalWidth}x${img.naturalHeight}`);
                }
              }}
            />
          ) : (
            /* Standby / Loading / Radar state */
            <div className="flex flex-col items-center justify-center text-center p-6 space-y-4">
              <div className="relative flex items-center justify-center">
                <div className="w-16 h-16 rounded-full border border-sky-500/20 animate-ping absolute" />
                <div className="w-12 h-12 rounded-full border border-sky-400/40 animate-pulse absolute" />
                <div className="w-10 h-10 rounded-full bg-sky-500/10 border border-sky-500/60 flex items-center justify-center">
                  <svg className="w-5 h-5 text-sky-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-200">
                  {status === "waiting_device"
                    ? "Connecting to Screen Pipe..."
                    : status === "connecting_ws"
                    ? "Connecting to Relay..."
                    : status === "stopped"
                    ? "Stream Inactive"
                    : "Connecting..."}
                </p>
                <p className="text-[11px] text-slate-400 max-w-[200px] leading-relaxed">
                  {status === "stopped"
                    ? "Click 'Restart Stream' below to resume live view."
                    : "Waking target phone to stream live screen & audio silently."}
                </p>
              </div>

              {status === "stopped" && (
                <button
                  onClick={startStream}
                  className="px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition shadow-sm"
                >
                  Restart Stream
                </button>
              )}

              {status === "waiting_device" && (
                <div className="text-[10px] text-slate-500 bg-slate-900/60 rounded p-2 max-w-[220px]">
                  💡 Tip: The target phone must have SPApp Accessibility Service enabled in Android Settings.
                </div>
              )}
            </div>
          )}

          {/* Bottom Home Indicator Bar */}
          <div className="absolute bottom-2 z-20 w-24 h-1 bg-slate-700/60 rounded-full backdrop-blur-sm pointer-events-none" />
        </div>
      </div>

      {/* Bottom Control Bar */}
      <div className="w-full max-w-md mt-4 flex flex-wrap items-center justify-center gap-2 pt-2">
        {/* Audio Mute/Unmute toggle */}
        <button
          onClick={() => {
            getAudioContext();
            setIsMuted((prev) => !prev);
          }}
          title={isMuted ? "Unmute Ambient Audio" : "Mute Ambient Audio"}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition shadow-sm ${
            isMuted
              ? "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              : "bg-indigo-600 hover:bg-indigo-500 text-white"
          }`}
        >
          {isMuted ? (
            <>
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
              <span>Muted</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4 text-emerald-300 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
              <span>Live Audio</span>
            </>
          )}
        </button>

        <button
          onClick={handleSnapshot}
          disabled={!frameUrl}
          title="Save screenshot"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-medium transition disabled:opacity-40 disabled:hover:bg-slate-800 shadow-sm"
        >
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>Snapshot</span>
        </button>

        {status === "streaming" || status === "waiting_device" ? (
          <button
            onClick={stopStream}
            title="Stop screen stream"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-medium transition shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
            <span>Stop Stream</span>
          </button>
        ) : (
          <button
            onClick={startStream}
            title="Start screen stream"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Start Stream</span>
          </button>
        )}

        <button
          onClick={startStream}
          title="Reconnect / Re-sync"
          className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>

        {!isStandalone && onPopOut && (
          <button
            onClick={onPopOut}
            title="Open in separate window"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-700/80 hover:bg-sky-600 text-white text-xs font-medium transition shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            <span>Pop Out</span>
          </button>
        )}
      </div>
    </div>
  );
}
