const { kv } = require("../../_lib/kv");
const { requireAuth } = require("../../_lib/admin-auth");

/**
 * PATCH /api/admin/keys/[hash]
 * Update a license (revoke, etc.)
 *
 * Request:
 *   { revoked: boolean, expires_at?: number }
 *
 * Response:
 *   { success: boolean, message: string }
 *
 * GET /api/admin/keys/[hash]
 * Get license status (for realtime check)
 */
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Verify admin token
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { hash } = req.query;

  if (!hash) {
    return res.status(400).json({
      error: "MISSING_PARAM",
      message: "hash parameter required",
    });
  }

  if (req.method === "GET") {
    return handleGetStatus(hash, res);
  } else if (req.method === "PATCH") {
    return handleUpdateKey(hash, req, res);
  } else {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
};

/**
 * Get license status
 */
async function handleGetStatus(hash, res) {
  try {
    const license = await kv.hgetall(`license:${hash}`);

    if (!license || Object.keys(license).length === 0) {
      return res.status(404).json({
        error: "LICENSE_NOT_FOUND",
      });
    }

    return res.status(200).json({
      hash: hash.slice(0, 16) + "...",
      plan: license.plan,
      // ✅ Ensure revoked is always boolean
      revoked: license.revoked === "true" || license.revoked === true,
      bound_fingerprint: license.bound_fingerprint || null,
      activated_at: license.activated_at,
      created_at: license.created_at,
      expires_at: license.expires_at,
    });
  } catch (err) {
    console.error("Get status error:", err);
    return res.status(500).json({
      error: "INTERNAL_ERROR",
    });
  }
}

/**
 * Update license (revoke, etc.)
 */
async function handleUpdateKey(hash, req, res) {
  const { revoked, expires_at } = req.body;

  try {
    const license = await kv.hgetall(`license:${hash}`);

    if (!license || Object.keys(license).length === 0) {
      return res.status(404).json({
        error: "LICENSE_NOT_FOUND",
        message: "License not found",
      });
    }

    // Update fields
    const updates = {};
    if (typeof revoked === "boolean") {
      updates.revoked = revoked ? "true" : "false";
    }
    if (expires_at !== undefined) {
      updates.expires_at = expires_at ? expires_at.toString() : "null";
    }

    if (Object.keys(updates).length > 0) {
      await kv.hmset(`license:${hash}`, updates);

      // Log change
      const auditEntry = JSON.stringify({
        event: "license_updated",
        hash: hash.slice(0, 16) + "...",
        changes: updates,
        ts: Date.now(),
      });
      await kv.lpush(`audit:admin`, auditEntry);

      return res.status(200).json({
        success: true,
        message: "License updated",
        updates,
      });
    }

    return res.status(400).json({
      error: "NO_UPDATES",
      message: "No updates provided",
    });
  } catch (err) {
    console.error("Update key error:", err);
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Failed to update license",
    });
  }
}
