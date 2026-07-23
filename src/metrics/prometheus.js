import client from "prom-client";

// Collect default Node.js process metrics (CPU, memory, event loop lag, etc.)
client.collectDefaultMetrics();

export const register = client.register;

// Cache metrics — mirrors what cacheAside.js already tracks in-memory,
// but exposed in a format Prometheus/Grafana can scrape and graph over time.
export const cacheHitsTotal = new client.Counter({
  name: "cache_hits_total",
  help: "Total number of cache hits",
});

export const cacheMissesTotal = new client.Counter({
  name: "cache_misses_total",
  help: "Total number of cache misses",
});

export const cacheLockWaitsTotal = new client.Counter({
  name: "cache_lock_waits_total",
  help: "Total number of requests that waited on another request's cache rebuild lock",
});

// HTTP request duration, labeled by route/method/status — lets you see
// which endpoints are slow and whether caching is actually helping.
export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

/**
 * Express middleware that times every request and records it in the histogram.
 */
export function httpMetricsMiddleware(req, res, next) {
  const endTimer = httpRequestDuration.startTimer();

  res.on("finish", () => {
    // req.route.path gives the matched route pattern (e.g. "/products/:id")
    // instead of the raw URL, so metrics group correctly instead of creating
    // one label per unique product id.
    const route = req.route?.path || req.path;
    endTimer({ method: req.method, route, status_code: res.statusCode });
  });

  next();
}
