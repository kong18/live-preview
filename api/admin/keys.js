const { kv } = require("../_lib/kv");
const {
  generateKey,
  hashKey,
  calculateExpiry,
  hashIP,
  truncateFingerprint,
} = require("../_lib/license-utils");
const { requireAuth } = require("../_lib/admin-auth");

/**
 * GET /api/admin/keys
 * List all licenses (paginated)
 *
 * Query: ?page=1&pageSize=20
 *
 * POST /api/admin/keys
 * Create new license keys
 *
 * Request:
 *   { quantity: number, plan: string ('30d'|'90d'|'365d'|'perpetual') }
 *
 * Response:
 *   { keys: string[], plan: string, expiresAt: number|null }
 */
module.exports = async function adminKeysHandler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Verify admin token
  const auth = await requireAuth(req, res);
  if (!auth) return; // Error already sent by requireAuth

  if (req.method === "GET") {
    return handleListKeys(req, res);
  } else if (req.method === "POST") {
    return handleCreateKeys(req, res);
  } else {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
};

/**
 * List all licenses
 */
// Shape a raw KV license hash into the response object the UI expects.
function mapLicense(hash, license) {
  return {
    // ✅ Full 64-char hash for API calls (revoke, validate, etc.)
    key_hash: hash,

    // ✅ Truncated hash for UI display only
    hash: `${hash.slice(0, 8)}...${hash.slice(-8)}`,

    // ✅ Original plaintext token (null for legacy keys created before
    // we started storing it — those remain hash-only / not recoverable)
    key: license.plain_key || null,

    plan: license.plan,
    // ✅ Always ensure revoked is boolean (handle both "true"/"false" strings and missing values)
    revoked: license.revoked === "true" || license.revoked === true,
    bound_fingerprint: license.bound_fingerprint ? "bound" : "unbound",
    created_at: license.created_at,
    expires_at: license.expires_at,

    // Optional: helpful metadata
    activated: !!license.activated_at,
    last_seen: license.last_seen,
  };
}

// Load + map a license hash, returning null if the record is missing/empty.
async function loadLicense(hash) {
  const license = await kv.hgetall(`license:${hash}`);
  if (!license || Object.keys(license).length === 0) return null;
  return mapLicense(hash, license);
}

// Filter path: load every license so the match spans all pages, then paginate.
async function filterLicenses(hashes, query, start, pageSize) {
  const matches = [];
  for (const hash of hashes) {
    const mapped = await loadLicense(hash);
    if (!mapped) continue;

    const token = (mapped.key || "").toLowerCase();
    if (token.includes(query) || hash.toLowerCase().includes(query)) {
      matches.push(mapped);
    }
  }
  return { items: matches.slice(start, start + pageSize), total: matches.length };
}

// Unfiltered path: only load the requested page slice (cheap).
async function pageLicenses(hashes, start, pageSize) {
  const items = [];
  for (const hash of hashes.slice(start, start + pageSize)) {
    const mapped = await loadLicense(hash);
    if (mapped) items.push(mapped);
  }
  return { items, total: hashes.length };
}

async function handleListKeys(req, res) {
  // Clamp inputs so bad query params can't break pagination
  const page = Math.max(1, Number.parseInt(req.query.page || "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(req.query.pageSize || "20", 10) || 20)
  );

  // Optional token filter (matches plaintext token or hash, case-insensitive)
  const query = (req.query.q || "").toString().trim().toLowerCase();
  const start = (page - 1) * pageSize;

  try {
    // Get all license hashes from sorted set, newest first.
    // Score = creation timestamp, so `rev: true` returns the latest keys first.
    const allHashes = await kv.zrange("licenses:all", 0, -1, {
      withScores: true,
      rev: true,
    });

    // withScores returns [member, score, member, score, ...] — pull just the
    // hashes, preserving the newest-first order.
    const hashes = [];
    for (let i = 0; i < allHashes.length; i += 2) {
      hashes.push(allHashes[i]);
    }

    const { items, total } = query
      ? await filterLicenses(hashes, query, start, pageSize)
      : await pageLicenses(hashes, start, pageSize);

    return res.status(200).json({
      licenses: items,
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("List keys error:", err);
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Failed to list licenses",
    });
  }
}

/**
 * Create new license keys
 */
async function handleCreateKeys(req, res) {
  const { quantity = 1, plan = "30d" } = req.body;

  // Validate
  if (!quantity || quantity < 1 || quantity > 1000) {
    return res.status(400).json({
      error: "INVALID_QUANTITY",
      message: "quantity must be between 1 and 1000",
    });
  }

  const validPlans = ["30d", "90d", "365d", "perpetual"];
  if (!validPlans.includes(plan)) {
    return res.status(400).json({
      error: "INVALID_PLAN",
      message: `plan must be one of: ${validPlans.join(", ")}`,
    });
  }

  try {
    const createdKeys = [];
    const expiresAt = calculateExpiry(plan);
    const now = Date.now();

    for (let i = 0; i < quantity; i++) {
      const plainKey = generateKey("LIVE");
      const hashedKey = hashKey(plainKey);
      const licenseKey = `license:${hashedKey}`;

      // Store license in KV
      await kv.hmset(licenseKey, {
        prefix: "LIVE",
        plan,
        // Plaintext token so the admin dashboard can display/copy the
        // original key (hash stays the lookup id). Older licenses created
        // before this field existed simply won't have it.
        plain_key: plainKey,
        expires_at: expiresAt ? expiresAt.toString() : "null",
        revoked: "false",
        created_at: now.toString(),
      });

      // Add to licenses:all sorted set (score = creation timestamp)
      await kv.zadd("licenses:all", { score: now, member: hashedKey });

      // Store plain key only in response (shown only once to admin)
      createdKeys.push(plainKey);
    }

    // Log creation event
    const auditEntry = JSON.stringify({
      event: "keys_created",
      quantity,
      plan,
      by: req.headers.authorization?.split(" ")[1]?.slice(0, 8) || "unknown",
      ts: now,
    });
    await kv.lpush("audit:admin", auditEntry);
    await kv.ltrim("audit:admin", 0, 999);

    return res.status(201).json({
      success: true,
      quantity,
      plan,
      expires_at: expiresAt,
      keys: createdKeys,
      message: "Save these keys! They will not be shown again.",
    });
  } catch (err) {
    console.error("Create keys error:", err);
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Failed to create keys",
    });
  }
}
