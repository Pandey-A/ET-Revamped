const crypto = require('crypto');

let redisClient = null;
let redisEnabled = false;

try {
  if (process.env.REDIS_URL) {
    const Redis = require('ioredis');
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    redisClient.connect().catch((err) => {
      console.error('Redis connect error, falling back to in-memory security controls:', err.message || err);
    });

    redisClient.on('ready', () => {
      redisEnabled = true;
      console.log('Redis connected: using distributed security controls');
    });

    redisClient.on('error', (err) => {
      redisEnabled = false;
      console.error('Redis error, using in-memory fallback:', err.message || err);
    });

    redisClient.on('end', () => {
      redisEnabled = false;
    });
  }
} catch (err) {
  console.error('Redis setup unavailable, using in-memory fallback:', err.message || err);
}

const rateBuckets = new Map();
const activeRequests = new Map();

function getClientIp(req) {
  return (
    req.ip ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function getDeviceFingerprint(req) {
  const explicitDevice = String(req.headers['x-device-id'] || '').trim();
  if (explicitDevice) return explicitDevice;

  const ua = String(req.headers['user-agent'] || 'ua:unknown');
  const ip = getClientIp(req);
  return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 20);
}

function getRequestKey(req, prefix) {
  const userId = req.user?.id || req.user?._id;
  const identity = userId ? `user:${userId}` : `ip:${getClientIp(req)}`;
  return `${prefix}:${identity}`;
}

function createRateLimiter(options = {}) {
  const {
    windowMs = 60 * 1000,
    max = 60,
    prefix = 'api',
    code = 'RATE_LIMIT_EXCEEDED',
    keyGenerator,
    message = 'Too many requests. Please try again in a moment.',
  } = options;

  return async function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = keyGenerator ? keyGenerator(req, prefix) : getRequestKey(req, prefix);
    if (!key) {
      return res.status(400).json({ success: false, message: 'Invalid limiter key' });
    }

    let count;
    let resetAt;

    if (redisEnabled && redisClient) {
      const redisKey = `rl:${key}`;
      try {
        count = await redisClient.incr(redisKey);
        if (count === 1) {
          await redisClient.pexpire(redisKey, windowMs);
        }
        const ttlMs = await redisClient.pttl(redisKey);
        resetAt = now + Math.max(ttlMs, 0);
      } catch (err) {
        redisEnabled = false;
      }
    }

    if (!count) {
      const existing = rateBuckets.get(key);
      let bucket = existing;
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
      }

      bucket.count += 1;
      rateBuckets.set(key, bucket);
      count = bucket.count;
      resetAt = bucket.resetAt;
    }

    const remaining = Math.max(max - count, 0);
    const retryAfterSec = Math.max(Math.ceil((resetAt - now) / 1000), 1);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

    if (count > max) {
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        success: false,
        code,
        message,
        retryAfterSec,
      });
    }

    return next();
  };
}

function singleInFlightGuard(options = {}) {
  const {
    ttlMs = 120000,
    keyPrefix = 'analysis',
    message = 'An analysis request is already running for this account. Please wait for it to finish.',
  } = options;

  return async function singleFlightMiddleware(req, res, next) {
    const key = getRequestKey(req, keyPrefix);
    const now = Date.now();
    const requestId = `${now}-${Math.random().toString(36).slice(2)}`;

    if (redisEnabled && redisClient) {
      const redisKey = `sif:${key}`;
      try {
        const acquired = await redisClient.set(redisKey, requestId, 'PX', ttlMs, 'NX');
        if (!acquired) {
          const ttl = await redisClient.pttl(redisKey);
          const retryAfterSec = Math.max(Math.ceil(Math.max(ttl, 0) / 1000), 1);
          res.setHeader('Retry-After', String(retryAfterSec));
          return res.status(429).json({
            success: false,
            code: 'REQUEST_ALREADY_IN_PROGRESS',
            message,
            retryAfterSec,
          });
        }

        const clearRedisIfCurrent = async () => {
          try {
            const releaseScript = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
            await redisClient.eval(releaseScript, 1, redisKey, requestId);
          } catch (err) {
            // ignore release errors
          }
        };

        res.on('finish', clearRedisIfCurrent);
        res.on('close', clearRedisIfCurrent);
        return next();
      } catch (err) {
        redisEnabled = false;
      }
    }

    const entry = activeRequests.get(key);

    if (entry && entry.expiresAt > now) {
      const retryAfterSec = Math.max(Math.ceil((entry.expiresAt - now) / 1000), 1);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        success: false,
        code: 'REQUEST_ALREADY_IN_PROGRESS',
        message,
        retryAfterSec,
      });
    }

    activeRequests.set(key, { requestId, expiresAt: now + ttlMs });

    const clearIfCurrent = () => {
      const current = activeRequests.get(key);
      if (current && current.requestId === requestId) {
        activeRequests.delete(key);
      }
    };

    res.on('finish', clearIfCurrent);
    res.on('close', clearIfCurrent);

    return next();
  };
}

module.exports = {
  createRateLimiter,
  singleInFlightGuard,
  getDeviceFingerprint,
};
