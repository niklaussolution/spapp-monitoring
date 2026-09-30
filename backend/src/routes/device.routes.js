const express = require("express");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth.middleware");
const { generateDeviceToken } = require("../utils/tokens");

const router = express.Router();

const DEFAULT_FLAGS_COLUMNS = [
  "location_on_demand", "geofencing", "app_usage_tracking", "web_history_tracking",
  "app_blocking", "sms_log", "call_log", "remote_lock", "file_manager", "installed_apps_list",
];

/**
 * POST /api/devices
 * (Admin, authenticated) Creates a new device placeholder for the tenant and
 * returns an install token. The target phone uses this token once, during
 * app install, to activate itself via POST /api/devices/activate.
 */
router.post(
  "/",
  requireAuth,
  [body("deviceLabel").isString().trim().isLength({ min: 1 })],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { deviceLabel } = req.body;
    const deviceToken = generateDeviceToken();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const deviceResult = await client.query(
        `INSERT INTO devices (tenant_id, device_label, device_token, status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING id, device_label, device_token, status, created_at`,
        [req.auth.tenantId, deviceLabel, deviceToken]
      );
      const device = deviceResult.rows[0];

      await client.query("INSERT INTO feature_flags (device_id) VALUES ($1)", [device.id]);

      await client.query("COMMIT");
      res.status(201).json(device);
    } catch (err) {
      await client.query("ROLLBACK");
      next(err);
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/devices
 * (Admin, authenticated) Lists devices belonging to the caller's own tenant only.
 */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, device_label, status, platform, os_version, app_version,
              consent_given_at, last_seen_at, created_at
       FROM devices WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [req.auth.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/devices/:id
 * (Admin, authenticated) Device detail + feature flags. Scoped to caller's tenant.
 */
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const deviceResult = await pool.query(
      `SELECT id, device_label, status, platform, os_version, app_version,
              consent_given_at, last_seen_at, created_at
       FROM devices WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.auth.tenantId]
    );
    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: "Device not found" });
    }

    const flagsResult = await pool.query(
      "SELECT * FROM feature_flags WHERE device_id = $1",
      [req.params.id]
    );

    res.json({ ...deviceResult.rows[0], featureFlags: flagsResult.rows[0] || null });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/devices/:id/feature-flags
 * (Admin, authenticated) Admin selects which agreed-scope features are active for this device.
 */
router.patch("/:id/feature-flags", requireAuth, async (req, res, next) => {
  try {
    const ownsDevice = await pool.query(
      "SELECT id FROM devices WHERE id = $1 AND tenant_id = $2",
      [req.params.id, req.auth.tenantId]
    );
    if (ownsDevice.rows.length === 0) {
      return res.status(404).json({ error: "Device not found" });
    }

    const updates = {};
    for (const col of DEFAULT_FLAGS_COLUMNS) {
      if (typeof req.body[col] === "boolean") updates[col] = req.body[col];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid feature flags provided" });
    }

    const setClauses = Object.keys(updates).map((col, i) => `${col} = $${i + 2}`);
    const values = [req.params.id, ...Object.values(updates)];

    const result = await pool.query(
      `UPDATE feature_flags SET ${setClauses.join(", ")}, updated_at = now()
       WHERE device_id = $1 RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/devices/activate
 * (Public — called by the Android app once, right after the user taps "Allow"
 * on the on-device consent screen.) Exchanges the one-time device_token for a
 * long-lived device auth token and marks consent as given.
 */
router.post(
  "/activate",
  [
    body("deviceToken").isString().notEmpty(),
    body("osVersion").optional().isString(),
    body("appVersion").optional().isString(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { deviceToken, osVersion, appVersion } = req.body;

    try {
      const result = await pool.query(
        `UPDATE devices
         SET status = 'active', consent_given_at = now(), last_seen_at = now(),
             os_version = COALESCE($2, os_version), app_version = COALESCE($3, app_version),
             updated_at = now()
         WHERE device_token = $1
         RETURNING id, tenant_id, device_label, status`,
        [deviceToken, osVersion || null, appVersion || null]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Invalid device token" });
      }

      const device = result.rows[0];
      const authToken = jwt.sign(
        { sub: device.id, tenantId: device.tenant_id, role: "device" },
        process.env.JWT_SECRET,
        { expiresIn: "365d" }
      );

      res.json({ authToken, device });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/devices/:id/app-usage?date=YYYY-MM-DD
 * (Admin, authenticated) Reads synced app usage for one day, scoped to caller's tenant.
 */
router.get("/:id/app-usage", requireAuth, async (req, res, next) => {
  try {
    const ownsDevice = await pool.query(
      "SELECT id FROM devices WHERE id = $1 AND tenant_id = $2",
      [req.params.id, req.auth.tenantId]
    );
    if (ownsDevice.rows.length === 0) return res.status(404).json({ error: "Device not found" });

    const date = req.query.date;
    const result = date
      ? await pool.query(
          "SELECT package_name, app_name, usage_seconds, usage_date FROM app_usage_logs WHERE device_id = $1 AND usage_date = $2 ORDER BY usage_seconds DESC",
          [req.params.id, date]
        )
      : await pool.query(
          "SELECT package_name, app_name, usage_seconds, usage_date FROM app_usage_logs WHERE device_id = $1 ORDER BY usage_date DESC, usage_seconds DESC LIMIT 200",
          [req.params.id]
        );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/devices/:id/sms-log
 */
router.get("/:id/sms-log", requireAuth, async (req, res, next) => {
  try {
    const ownsDevice = await pool.query(
      "SELECT id FROM devices WHERE id = $1 AND tenant_id = $2",
      [req.params.id, req.auth.tenantId]
    );
    if (ownsDevice.rows.length === 0) return res.status(404).json({ error: "Device not found" });

    const result = await pool.query(
      "SELECT direction, counterparty, message_at FROM sms_logs WHERE device_id = $1 ORDER BY message_at DESC LIMIT 200",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/devices/:id/call-log
 */
router.get("/:id/call-log", requireAuth, async (req, res, next) => {
  try {
    const ownsDevice = await pool.query(
      "SELECT id FROM devices WHERE id = $1 AND tenant_id = $2",
      [req.params.id, req.auth.tenantId]
    );
    if (ownsDevice.rows.length === 0) return res.status(404).json({ error: "Device not found" });

    const result = await pool.query(
      "SELECT direction, counterparty, duration_sec, called_at FROM call_logs WHERE device_id = $1 ORDER BY called_at DESC LIMIT 200",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/devices/:id/installed-apps
 */
router.get("/:id/installed-apps", requireAuth, async (req, res, next) => {
  try {
    const ownsDevice = await pool.query(
      "SELECT id FROM devices WHERE id = $1 AND tenant_id = $2",
      [req.params.id, req.auth.tenantId]
    );
    if (ownsDevice.rows.length === 0) return res.status(404).json({ error: "Device not found" });

    const result = await pool.query(
      "SELECT package_name, app_name, install_date, synced_at FROM installed_apps WHERE device_id = $1 ORDER BY app_name",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
