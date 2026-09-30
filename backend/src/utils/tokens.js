const crypto = require("crypto");

/** Generates a URL-safe random token used as a device's one-time install/auth token. */
function generateDeviceToken() {
  return crypto.randomBytes(24).toString("base64url");
}

module.exports = { generateDeviceToken };
