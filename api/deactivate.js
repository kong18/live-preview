const { kv } = require('./_lib/kv');
const { hashKey } = require('./_lib/license-utils');

/**
 * POST /api/deactivate
 * Unbind a license from a machine (allows rebinding on same/different machine)
 *
 * Request:
 *   { key, fingerprint }
 *
 * Response:
 *   { success: boolean, message: string }
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const { key, fingerprint } = req.body;

  if (!key || !fingerprint) {
    return res.status(400).json({
      error: 'MISSING_PARAMS',
      message: 'key and fingerprint are required',
    });
  }

  const hashedKey = hashKey(key);
  const licenseKey = `license:${hashedKey}`;

  try {
    // Fetch license
    const license = await kv.hgetall(licenseKey);

    if (!license || Object.keys(license).length === 0) {
      return res.status(404).json({
        error: 'LICENSE_NOT_FOUND',
        message: 'Invalid license key',
      });
    }

    // Verify this machine is the one bound
    if (license.bound_fingerprint !== fingerprint) {
      return res.status(403).json({
        error: 'FINGERPRINT_MISMATCH',
        message: 'This license is not bound to this machine',
      });
    }

    // Unbind the machine
    await kv.hdel(licenseKey, 'bound_fingerprint');
    await kv.del(`binding:${fingerprint}`);

    // Log deactivation
    const auditEntry = JSON.stringify({
      event: 'deactivated',
      fingerprint: fingerprint.slice(0, 16) + '...',
      ts: Date.now(),
    });
    await kv.lpush(`audit:${hashedKey}`, auditEntry);

    return res.status(200).json({
      success: true,
      message: 'License deactivated. You can now activate it on another machine.',
    });
  } catch (err) {
    console.error('Deactivate error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to deactivate license',
    });
  }
};
