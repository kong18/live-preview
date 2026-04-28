const { kv } = require('./_lib/kv');
const { hashKey, hashIP, truncateFingerprint } = require('./_lib/license-utils');
const rateLimit = require('./_lib/rate-limit');

/**
 * POST /api/activate
 * Activate a license key on a machine (first-time binding)
 *
 * Request:
 *   { key, fingerprint, userAgent }
 *
 * Response:
 *   { success, plan, expires_at, activated_at, features }
 */
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  // Rate limit: 5 activations per 60 seconds per IP
  const allowed = await rateLimit.check(req, 'activate', 5, 60);
  if (!allowed) {
    return res.status(429).json({
      error: 'RATE_LIMITED',
      message: 'Too many activation attempts. Try again in 60 seconds.',
      retryAfter: 60,
    });
  }

  const { key, fingerprint, userAgent } = req.body;

  // Validation
  if (!key || !fingerprint) {
    return res.status(400).json({
      error: 'MISSING_PARAMS',
      message: 'key and fingerprint are required',
    });
  }

  const hashedKey = hashKey(key);
  const licenseKey = `license:${hashedKey}`;

  try {
    // 1. Fetch license from KV
    const license = await kv.hgetall(licenseKey);

    if (!license || Object.keys(license).length === 0) {
      return res.status(404).json({
        error: 'LICENSE_NOT_FOUND',
        message: 'Invalid license key',
      });
    }

    // 2. Check if revoked
    if (license.revoked === 'true' || license.revoked === true) {
      return res.status(403).json({
        error: 'LICENSE_REVOKED',
        message: 'This license has been revoked by administrator',
      });
    }

    // 3. Check expiration
    const expiresAt = parseInt(license.expires_at, 10);
    if (!isNaN(expiresAt) && Date.now() > expiresAt) {
      return res.status(403).json({
        error: 'LICENSE_EXPIRED',
        message: 'License expired',
        expired_at: new Date(expiresAt).toISOString(),
      });
    }

    // 4. Check machine binding (if already bound to different machine)
    if (license.bound_fingerprint && license.bound_fingerprint !== fingerprint) {
      return res.status(403).json({
        error: 'LICENSE_BOUND_TO_OTHER_MACHINE',
        message: 'This license is already bound to another machine',
        hint: 'Contact administrator to deactivate on the other machine first',
      });
    }

    // 5. First activation: bind this machine
    if (!license.bound_fingerprint) {
      await kv.hmset(licenseKey, {
        bound_fingerprint: fingerprint,
        activated_at: Date.now().toString(),
      });

      // Create reverse index for easy lookup by fingerprint
      await kv.set(`binding:${fingerprint}`, hashedKey);
    }

    // 6. Update audit metadata
    await kv.hmset(`audit:${hashedKey}`, {
      last_seen: Date.now().toString(),
      last_fingerprint: fingerprint,
    });

    // 7. Log activation event (keep last 100)
    const auditEntry = JSON.stringify({
      event: 'activated',
      fingerprint: truncateFingerprint(fingerprint),
      user_agent: userAgent ? userAgent.slice(0, 100) : 'unknown',
      ip_hash: hashIP(req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'] || 'unknown'),
      ts: Date.now(),
    });

    await kv.lpush(`audit:${hashedKey}`, auditEntry);
    await kv.ltrim(`audit:${hashedKey}`, 0, 99); // Keep only last 100 entries

    // 8. Return success (do NOT return plain key)
    return res.status(200).json({
      success: true,
      plan: license.plan,
      expires_at: license.expires_at,
      activated_at: license.activated_at,
      features: ['webcam', 'screen-share', 'flip', 'fullscreen'],
    });
  } catch (err) {
    console.error('Activate error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to activate license',
    });
  }
};
