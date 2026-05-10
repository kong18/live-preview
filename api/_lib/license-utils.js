const crypto = require('crypto');

module.exports = {
  /**
   * Generate new license key: LIVE-XXXX-XXXX-XXXX
   */
  generateKey: (prefix = 'LIVE') => {
    const rand = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${prefix}-${rand()}-${rand()}-${rand()}`;
  },

  /**
   * Hash key for storage (SHA-256) - never store plain text
   */
  hashKey: (key) => {
    return crypto.createHash('sha256').update(key).digest('hex');
  },

  /**
   * Create HMAC token for binding verification
   */
  createBindingToken: (key, fingerprint) => {
    return crypto
      .createHmac('sha256', process.env.LICENSE_SECRET || 'default-secret')
      .update(`${key}:${fingerprint}`)
      .digest('hex');
  },

  /**
   * Calculate expiration timestamp based on plan
   * @param {string} plan - '30d', '90d', '365d', or 'perpetual'
   * @returns {number|null} timestamp in ms, or null if perpetual
   */
  calculateExpiry: (plan) => {
    const periods = {
      '30d': 30,
      '90d': 90,
      '365d': 365,
    };

    if (plan === 'perpetual') return null;

    const days = periods[plan] || 30;
    return Date.now() + days * 24 * 60 * 60 * 1000;
  },

  /**
   * Hash IP for audit log (privacy - never store raw IP)
   */
  hashIP: (ip) => {
    return crypto
      .createHash('sha256')
      .update(ip + (process.env.LICENSE_SECRET || 'default-secret'))
      .digest('hex')
      .slice(0, 16);
  },

  /**
   * Truncate fingerprint for logs (privacy)
   */
  truncateFingerprint: (fp) => {
    return fp ? fp.slice(0, 16) + '...' : 'unknown';
  },
};
