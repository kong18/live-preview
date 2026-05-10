const jwt = require('jsonwebtoken');
const bcryptjs = require('bcryptjs');
const { getConfig } = require('../_lib/edge-config');

/**
 * POST /api/admin/auth
 * Admin login - exchange email + password for JWT token
 *
 * Request:
 *   { email, password }
 *
 * Response:
 *   { token: string, expiresIn: string } or { error, message }
 */
module.exports = async function adminAuth(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: 'MISSING_PARAMS',
      message: 'email and password are required',
    });
  }

  try {
    // Get admin credentials from Edge Config
    const admins = await getConfig('admin_credentials', {});

    if (!admins[email]) {
      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Email or password incorrect',
      });
    }

    // Verify password (bcrypt hash)
    const passwordHash = admins[email];
    const passwordValid = await bcryptjs.compare(password, passwordHash);

    if (!passwordValid) {
      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Email or password incorrect',
      });
    }

    // Create JWT token
    const token = jwt.sign(
      {
        email,
        role: 'admin',
        iat: Date.now(),
      },
      process.env.ADMIN_JWT_SECRET || 'default-secret',
      { expiresIn: '24h' }
    );

    return res.status(200).json({
      token,
      expiresIn: '24h',
      email,
    });
  } catch (err) {
    if (err?.message === 'MISSING_EDGE_CONFIG') {
      return res.status(500).json({
        error: 'CONFIG_NOT_READY',
        message: 'Missing EDGE_CONFIG environment variable. Pull Vercel env vars or add the Edge Config connection string in the Vercel project settings.',
      });
    }

    console.error('Auth error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Login failed',
    });
  }
};
