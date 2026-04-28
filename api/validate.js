const { kv } = require("./_lib/kv");
const { hashKey } = require("./_lib/license-utils");

/**
 * POST /api/validate
 * Check if a license is valid (heartbeat / periodic validation)
 *
 * Request:
 *   { key, fingerprint }
 *
 * Response:
 *   { valid: boolean, expires_at?, remaining_ms?, error? }
 */
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ valid: false, error: "METHOD_NOT_ALLOWED" });
  }

  const { key, fingerprint } = req.body;

  if (!key || !fingerprint) {
    return res.status(400).json({
      valid: false,
      error: "MISSING_PARAMS",
      message: "key and fingerprint are required",
    });
  }

  const hashedKey = hashKey(key);

  try {
    // Fetch license from KV
    const license = await kv.hgetall(`license:${hashedKey}`);

    // Check validity conditions
    const isValid =
      license &&
      Object.keys(license).length > 0 &&
      license.revoked !== "true" &&
      license.revoked !== true &&
      (!license.expires_at || Date.now() <= parseInt(license.expires_at, 10)) &&
      (!license.bound_fingerprint || license.bound_fingerprint === fingerprint);

    if (!isValid) {
      return res.status(403).json({
        valid: false,
        error: "LICENSE_INVALID",
        message:
          "License is invalid, expired, revoked, or bound to another machine",
      });
    }

    // Update last_seen in background (non-blocking)
    kv.hmset(`license:${hashedKey}`, {
      last_seen: Date.now().toString(),
      last_fingerprint: fingerprint,
    }).catch((err) => console.warn("Failed to update last_seen:", err));

    // Calculate remaining time
    const expiresAt = license.expires_at
      ? parseInt(license.expires_at, 10)
      : null;
    const remainingMs = expiresAt ? Math.max(0, expiresAt - Date.now()) : null;

    return res.status(200).json({
      valid: true,
      expires_at: license.expires_at,
      remaining_ms: remainingMs,
    });
  } catch (err) {
    console.error("Validate error:", err);
    // Fail closed for security: if we can't verify, deny
    return res.status(500).json({
      valid: false,
      error: "VALIDATION_ERROR",
      message: "Failed to validate license",
    });
  }
};
