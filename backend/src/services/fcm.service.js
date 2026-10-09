const { getFirebaseAdmin } = require("./firebaseAdmin");

/**
 * Sends a silent data-only push to wake the device and trigger an immediate
 * sync or command execution.
 * When extraData is provided (e.g. { type: "command", commandType: "location_check" }),
 * the device's FirebaseMessagingService executes the fast command pass immediately
 * without waiting for WorkManager or periodic polling.
 */
async function sendSyncNudge(fcmToken, extraData = {}) {
  const admin = getFirebaseAdmin();
  if (!admin || !fcmToken) return { sent: false, reason: "fcm_unavailable" };

  try {
    const payloadData = {
      type: "sync",
      timestamp: Date.now().toString(),
      ...extraData,
    };
    const stringifiedData = {};
    for (const [key, val] of Object.entries(payloadData)) {
      stringifiedData[key] = String(val ?? "");
    }

    await admin.messaging().send({
      token: fcmToken,
      data: stringifiedData,
      android: {
        priority: "high",
        ttl: 60 * 1000,
      },
    });
    return { sent: true };
  } catch (err) {
    console.error("[fcm] send failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendSyncNudge };
