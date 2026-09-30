const jwt = require("jsonwebtoken");

/**
 * Verifies a device-scoped JWT (issued by POST /api/devices/activate).
 * Attaches { deviceId, tenantId } to req.device. Rejects admin-role tokens —
 * sync endpoints only accept tokens minted for a device.
 */
function requireDeviceAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "device") {
      return res.status(403).json({ error: "Not a device token" });
    }
    req.device = { deviceId: payload.sub, tenantId: payload.tenantId };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { requireDeviceAuth };
