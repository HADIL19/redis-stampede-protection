import redis from "../redisClient.js";

/**
 * Redis-backed rate limiter (fixed window counter).
 *
 * How it works:
 *  - Each client gets a key like `ratelimit:<identifier>:<windowStart>`.
 *  - INCR the key. If it's the first request in this window, set an
 *    expiry equal to the window length.
 *  - If the count exceeds the limit, reject with 429.
 *
 * Tradeoff vs a sliding-window log: fixed windows are cheap (one INCR +
 * one EXPIRE per request) but allow up to 2x the limit right at window
 * boundaries (e.g. a burst at the end of one window + a burst at the
 * start of the next). A sliding-window log (storing timestamps in a
 * sorted set) is more accurate but costs more memory and CPU per request.
 * Fixed window is the right choice here: predictable cost, and the
 * boundary-burst edge case rarely matters for typical API abuse protection.
 *
 * @param {object} options
 * @param {number} options.windowSeconds - length of each rate limit window
 * @param {number} options.maxRequests - max requests allowed per window
 * @param {(req) => string} [options.keyGenerator] - how to identify a client (defaults to IP)
 */
export function rateLimiter({ windowSeconds = 60, maxRequests = 100, keyGenerator } = {}) {
  const getIdentifier = keyGenerator || ((req) => req.ip);

  return async function rateLimiterMiddleware(req, res, next) {
    try {
      const identifier = getIdentifier(req);
      const windowStart = Math.floor(Date.now() / 1000 / windowSeconds);
      const key = `ratelimit:${identifier}:${windowStart}`;

      // INCR creates the key at 1 if it doesn't exist yet.
      const count = await redis.incr(key);

      if (count === 1) {
        // First request in this window — set the key to expire when the window ends.
        await redis.expire(key, windowSeconds);
      }

      const remaining = Math.max(0, maxRequests - count);
      res.set("X-RateLimit-Limit", String(maxRequests));
      res.set("X-RateLimit-Remaining", String(remaining));

      if (count > maxRequests) {
        const ttl = await redis.ttl(key);
        res.set("Retry-After", String(ttl > 0 ? ttl : windowSeconds));
        return res.status(429).json({
          error: "Too many requests",
          retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
        });
      }

      next();
    } catch (err) {
      // Fail open: if Redis is down, don't block all traffic because of it.
      // (Fail closed instead if rate limiting is a hard security requirement.)
      console.error("[rateLimiter] Redis error, allowing request:", err.message);
      next();
    }
  };
}
