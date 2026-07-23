import redis from "../redisClient.js";
import { cacheHitsTotal, cacheMissesTotal, cacheLockWaitsTotal } from "../metrics/prometheus.js";

// In-memory counters for the /metrics endpoint.
// (In a real system you'd push these to Prometheus/Datadog instead.)
export const metrics = {
  hits: 0,
  misses: 0,
  lockWaits: 0,
};

const LOCK_TTL_MS = 3000;
const LOCK_RETRY_DELAY_MS = 100;
const LOCK_MAX_RETRIES = 20;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cache-aside read with stampede protection.
 *
 * Flow:
 *  1. Try Redis. On hit -> return immediately.
 *  2. On miss -> try to acquire a short-lived lock for this key.
 *     - If we get the lock: fetch from source of truth, populate cache, release lock.
 *     - If we don't get the lock: someone else is already rebuilding this key,
 *       so poll Redis briefly instead of also hammering the DB (this is what
 *       prevents a "thundering herd" of requests all missing at once).
 *
 * @param {string} key - cache key
 * @param {number} ttlSeconds - how long to cache the value
 * @param {() => Promise<any>} fetchFromSource - function that loads the real data (e.g. a DB query)
 */
export async function getWithCacheAside(key, ttlSeconds, fetchFromSource) {
  const cached = await redis.get(key);
  if (cached !== null) {
    metrics.hits++;
    cacheHitsTotal.inc();
    return JSON.parse(cached);
  }

  metrics.misses++;
  cacheMissesTotal.inc();

  const lockKey = `lock:${key}`;
  // NX = only set if not already set, PX = expiry in ms. Acts as a mutex.
  const gotLock = await redis.set(lockKey, "1", "PX", LOCK_TTL_MS, "NX");

  if (gotLock) {
    try {
      const fresh = await fetchFromSource();
      await redis.set(key, JSON.stringify(fresh), "EX", ttlSeconds);
      return fresh;
    } finally {
      await redis.del(lockKey);
    }
  }

  // Someone else is rebuilding the cache for this key right now.
  // Poll instead of issuing a redundant DB query.
  metrics.lockWaits++;
  cacheLockWaitsTotal.inc();
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    await sleep(LOCK_RETRY_DELAY_MS);
    const retryCached = await redis.get(key);
    if (retryCached !== null) {
      return JSON.parse(retryCached);
    }
  }

  // Fallback: if the lock holder is somehow stuck, do the fetch ourselves
  // rather than making the client wait forever.
  return fetchFromSource();
}

/**
 * Invalidate one or more cache keys, e.g. after a write.
 */
export async function invalidate(...keys) {
  if (keys.length === 0) return;
  await redis.del(...keys);
}

export function getMetricsSnapshot() {
  const total = metrics.hits + metrics.misses;
  const hitRatio = total === 0 ? 0 : metrics.hits / total;
  return { ...metrics, total, hitRatio: Number(hitRatio.toFixed(3)) };
}
