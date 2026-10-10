require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { attachFileRelay } = require("./ws/fileRelay");
const { attachScreenRelay } = require("./ws/screenRelay");
const { attachCameraRelay } = require("./ws/cameraRelay");

const app = express();

app.use(helmet());

// DASHBOARD_ORIGIN accepts a comma-separated list, so local dev
// (http://localhost:5173) and a deployed dashboard URL can both be allowed
// at once without editing this file — just add to the env var.
const allowedOrigins = (process.env.DASHBOARD_ORIGIN || "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
  })
);
app.use(morgan("dev"));
app.use(express.json({ limit: "5mb" }));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "spapp-monitoring-backend" });
});

// Route mounts (added as each module is built)
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/tenants", require("./routes/tenant.routes"));
app.use("/api/devices", require("./routes/device.routes"));
app.use("/api/devices", require("./routes/command.routes"));
app.use("/api/devices", require("./routes/blockrule.routes"));
app.use("/api/sync", require("./routes/sync.routes"));
app.use("/api/admin", require("./routes/admin.routes"));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
attachFileRelay(server);
attachScreenRelay(server);
attachCameraRelay(server);

// Ensure call_logs & sms_logs have contact_name column
const pool = require("./db/pool");
pool
  .query(`
    ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255);
    ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255);
  `)
  .catch((err) => console.error("Auto-migration (contact_name) warning:", err.message));

server.listen(PORT, () => {
  console.log(`spapp-monitoring-backend listening on port ${PORT} (HTTP + WS file + screen + camera relay)`);
});
