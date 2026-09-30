const { getFirebaseAdmin } = require("./firebaseAdmin");

/**
 * Sends a silent data-only push to wake the device and trigger an immediate
 * sync pass. Never put command details in the push itself — the device reads
 * the actual command from GET /api/sync/commands, same as poll-based delivery.
 * If firebase-admin isn't configured, this fails soft — commands still work
 * via Phase 5's poll-based fallback, just less instantly.
 */
async function sendSyncNudge(fcmToken) {
  const admin = getFirebaseAdmin();
  if (!admin || !fcmToken) return { sent: false, reason: "fcm_unavailable" };

  try {
    await admin.messaging().send({
      token: fcmToken,
      data: { type: "sync" },
      android: { priority: "high" },
    });
    return { sent: true };
  } catch (err) {
    console.error("[fcm] send failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendSyncNudge };
