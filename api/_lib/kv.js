const { Redis } = require('@upstash/redis');

function createKvError() {
  return new Error('MISSING_UPSTASH_CONFIG');
}

function createKvClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  return new Redis({ url, token });
}

const redis = createKvClient();

const kv =
  redis ||
  new Proxy(
    {},
    {
      get() {
        return async () => {
          throw createKvError();
        };
      },
    }
  );

module.exports = { kv };
