const jwt = require('jsonwebtoken');

/**
 * Create JWT token for admin session
 */
function createToken(email) {
  return jwt.sign({ email, iat: Date.now() }, process.env.ADMIN_JWT_SECRET || 'default-secret', {
    expiresIn: '24h',
  });
}

/**
 * Verify JWT token from Authorization header
 * Returns { email } or throws error
 */
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);
  return jwt.verify(token, process.env.ADMIN_JWT_SECRET || 'default-secret');
}

/**
 * Middleware to protect admin routes
 * Returns { email } if valid, otherwise sends 401 response
 */
async function requireAuth(req, res) {
  try {
    const payload = verifyToken(req.headers.authorization);
    return payload;
  } catch (err) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: err.message,
    });
    return null;
  }
}

module.exports = {
  createToken,
  verifyToken,
  requireAuth,
};
