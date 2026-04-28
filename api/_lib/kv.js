const { Redis } = require('@upstash/redis');

// Init Upstash Redis client - used only in serverless functions
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = { kv };
