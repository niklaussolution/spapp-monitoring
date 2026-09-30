const jwt = require("jsonwebtoken");

/**
 * Verifies the Bearer JWT and attaches { userId, tenantId, role } to req.auth.
 * Every protected route relies on req.auth.tenantId for multi-tenant isolation.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = { userId: payload.sub, tenantId: payload.tenantId, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { requireAuth };
