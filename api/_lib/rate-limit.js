const { kv } = require('./kv');

/**
 * Simple rate limiter using Vercel KV with TTL
 * @param {Object} req - Vercel request object
 * @param {string} action - Action name (e.g., 'activate', 'validate')
 * @param {number} limit - Max attempts in window
 * @param {number} windowSec - Time window in seconds
 * @returns {boolean} true if within limit, false if rate limited
 */
async function check(req, action, limit = 10, windowSec = 60) {
  const ip =
    req.headers['x-vercel-forwarded-for']?.split(',')[0] ||
    req.headers['x-real-ip'] ||
    'unknown';

  const key = `ratelimit:${action}:${ip}`;

  try {
    const current = await kv.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= limit) {
      return false; // Rate limited
    }

    // Increment counter with TTL (first call sets TTL, subsequent increments do too)
    const newCount = count + 1;
    await kv.setex(key, windowSec, newCount.toString());

    return true; // Within limit
  } catch (err) {
    console.error(`Rate limit check failed for ${action}:`, err);
    // Fail open on error (allow request, better UX than blocking all requests)
    return true;
  }
}

module.exports = { check };
