const { kv } = require('../../_lib/kv');
const { generateKey, hashKey, calculateExpiry, hashIP, truncateFingerprint } =
  require('../../_lib/license-utils');
const { requireAuth } = require('../../_lib/admin-auth');

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify admin token
  const auth = await requireAuth(req, res);
  if (!auth) return; // Error already sent by requireAuth

  if (req.method === 'GET') {
    return handleListKeys(req, res);
  } else if (req.method === 'POST') {
    return handleCreateKeys(req, res);
  } else {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
};

/**
 * List all licenses
 */
async function handleListKeys(req, res) {
  const page = Number.parseInt(req.query.page || '1', 10);
  const pageSize = Number.parseInt(req.query.pageSize || '20', 10);

  try {
    // Get all license hashes from sorted set
    const allHashes = await kv.zrange('licenses:all', 0, -1, { withScores: true });

    const total = allHashes.length / 2; // withScores returns [member, score, member, score, ...]
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    const paginated = [];
    for (let i = start * 2; i < Math.min(end * 2, allHashes.length); i += 2) {
      const hash = allHashes[i];
      const license = await kv.hgetall(`license:${hash}`);
      if (license && Object.keys(license).length > 0) {
        paginated.push({
          hashRaw: hash,
          hash: hash.slice(0, 16) + '...',
          plan: license.plan,
          revoked: license.revoked === 'true',
          bound_fingerprint: license.bound_fingerprint ? 'bound' : 'unbound',
          created_at: license.created_at,
          expires_at: license.expires_at,
        });
      }
    }

    return res.status(200).json({
      licenses: paginated,
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error('List keys error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to list licenses',
    });
  }
}

/**
 * Create new license keys
 */
async function handleCreateKeys(req, res) {
  const { quantity = 1, plan = '30d' } = req.body;

  // Validate
  if (!quantity || quantity < 1 || quantity > 1000) {
    return res.status(400).json({
      error: 'INVALID_QUANTITY',
      message: 'quantity must be between 1 and 1000',
    });
  }

  const validPlans = ['30d', '90d', '365d', 'perpetual'];
  if (!validPlans.includes(plan)) {
    return res.status(400).json({
      error: 'INVALID_PLAN',
      message: `plan must be one of: ${validPlans.join(', ')}`,
    });
  }

  try {
    const createdKeys = [];
    const expiresAt = calculateExpiry(plan);
    const now = Date.now();

    for (let i = 0; i < quantity; i++) {
      const plainKey = generateKey('LIVE');
      const hashedKey = hashKey(plainKey);
      const licenseKey = `license:${hashedKey}`;

      // Store license in KV
      await kv.hmset(licenseKey, {
        prefix: 'LIVE',
        plan,
        expires_at: expiresAt ? expiresAt.toString() : 'null',
        revoked: 'false',
        created_at: now.toString(),
      });

      // Add to licenses:all sorted set (score = creation timestamp)
      await kv.zadd('licenses:all', { score: now, member: hashedKey });

      // Store plain key only in response (shown only once to admin)
      createdKeys.push(plainKey);
    }

    // Log creation event
    const auditEntry = JSON.stringify({
      event: 'keys_created',
      quantity,
      plan,
      by: req.headers.authorization?.split(' ')[1]?.slice(0, 8) || 'unknown',
      ts: now,
    });
    await kv.lpush('audit:admin', auditEntry);
    await kv.ltrim('audit:admin', 0, 999);

    return res.status(201).json({
      success: true,
      quantity,
      plan,
      expires_at: expiresAt,
      keys: createdKeys,
      message: 'Save these keys! They will not be shown again.',
    });
  } catch (err) {
    console.error('Create keys error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to create keys',
    });
  }
}
