const { get } = require('@vercel/edge-config');

// Simple in-memory cache for Edge Config values
const cache = new Map();
const CACHE_TTL = 30000; // 30 seconds

/**
 * Get value from Edge Config with fallback and caching
 */
async function getConfig(key, fallback = null) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.value;
  }

  try {
    const value = await get(key);
    cache.set(key, { value: value ?? fallback, ts: Date.now() });
    return value ?? fallback;
  } catch (err) {
    console.warn(`EdgeConfig get(${key}) failed:`, err.message);
    return fallback;
  }
}

module.exports = { getConfig };
