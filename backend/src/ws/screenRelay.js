const { WebSocketServer } = require("ws");
const jwt = require("jsonwebtoken");
const url = require("url");

/**
 * Live Device-to-Admin Screen Streaming WebSocket Relay
 *
 * Transmits real-time screen frames (JPEG binary frames) from target device
 * to admin dashboard popup window with zero disk storage or database persistence.
 *
 * Path:
 *   /ws/screen-stream?role=admin|device&token=<jwt>&deviceId=<id>
 */
function attachScreenRelay(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // deviceId -> { adminWsSet: Set<WebSocket>, deviceWs: WebSocket | null }
  const streams = new Map();

  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname, query } = url.parse(req.url, true);
    if (pathname !== "/ws/screen-stream") return;

    const { role, token, deviceId } = query;
    if (!role || !token || !deviceId || !["admin", "device"].includes(role)) {
      socket.destroy();
      return;
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      socket.destroy();
      return;
    }

    if (role === "device" && payload.role !== "device") {
      socket.destroy();
      return;
    }
    if (role === "admin" && payload.role === "device") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, { role, deviceId });
    });
  });

  wss.on("connection", (ws, req, { role, deviceId }) => {
    let stream = streams.get(deviceId);
    if (!stream) {
      stream = { adminWsSet: new Set(), deviceWs: null };
      streams.set(deviceId, stream);
    }

    if (role === "admin") {
      stream.adminWsSet.add(ws);
      console.log(`[screenRelay] Admin connected for device ${deviceId} (active viewers: ${stream.adminWsSet.size})`);

      if (stream.deviceWs && stream.deviceWs.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "status", status: "streaming", message: "Device streaming active" }));
      } else {
        ws.send(JSON.stringify({ type: "status", status: "waiting_device", message: "Waiting for device screen stream..." }));
      }

      ws.on("message", (msg) => {
        try {
          const parsed = JSON.parse(msg.toString());
          if (parsed.action === "stop") {
            if (stream.deviceWs && stream.deviceWs.readyState === ws.OPEN) {
              stream.deviceWs.send(JSON.stringify({ action: "stop" }));
            }
          }
        } catch {
          // ignore non-json messages
        }
      });

      ws.on("close", () => {
        stream.adminWsSet.delete(ws);
        console.log(`[screenRelay] Admin disconnected for device ${deviceId} (remaining: ${stream.adminWsSet.size})`);
        if (stream.adminWsSet.size === 0) {
          if (stream.deviceWs && stream.deviceWs.readyState === ws.OPEN) {
            stream.deviceWs.send(JSON.stringify({ action: "stop" }));
          }
          if (!stream.deviceWs) {
            streams.delete(deviceId);
          }
        }
      });

      ws.on("error", () => {
        stream.adminWsSet.delete(ws);
      });
    } else {
      console.log(`[screenRelay] Device ${deviceId} connected to screen stream`);
      stream.deviceWs = ws;

      for (const admin of stream.adminWsSet) {
        if (admin.readyState === ws.OPEN) {
          admin.send(JSON.stringify({ type: "status", status: "streaming", message: "Device screen stream started" }));
        }
      }

      ws.on("message", (data, isBinary) => {
        // Broadcast binary frame to all connected admins watching this device
        for (const admin of stream.adminWsSet) {
          if (admin.readyState === ws.OPEN) {
            admin.send(data, { binary: isBinary });
          }
        }
      });

      ws.on("close", () => {
        console.log(`[screenRelay] Device ${deviceId} stream closed`);
        if (stream.deviceWs === ws) {
          stream.deviceWs = null;
        }
        for (const admin of stream.adminWsSet) {
          if (admin.readyState === ws.OPEN) {
            admin.send(JSON.stringify({ type: "status", status: "device_stopped", message: "Device stopped screen streaming" }));
          }
        }
        if (stream.adminWsSet.size === 0) {
          streams.delete(deviceId);
        }
      });

      ws.on("error", () => {
        if (stream.deviceWs === ws) {
          stream.deviceWs = null;
        }
      });
    }
  });

  return wss;
}

module.exports = { attachScreenRelay };
