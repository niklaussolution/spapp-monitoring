const express = require("express");
const { requireAuth } = require("../middleware/auth.middleware");
const firestore = require("../services/firestore.service");

const router = express.Router();
router.use(requireAuth);

/**
 * GET /api/tenants/me
 * Returns the logged-in user's own tenant details (Firestore). Multi-tenant
 * apps never expose a "list all tenants" endpoint to a tenant-scoped user.
 */
router.get("/me", async (req, res, next) => {
  try {
    const tenant = await firestore.getTenant(req.auth.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    res.json({ id: tenant.id, name: tenant.name, type: tenant.type, created_at: tenant.createdAt });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tenants/me/users
 * Lists admin users belonging to the caller's own tenant only (Firestore).
 */
router.get("/me/users", async (req, res, next) => {
  try {
    const users = await firestore.listUsersByTenant(req.auth.tenantId);
    res.json(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        full_name: u.fullName,
        role: u.role,
        created_at: u.createdAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
