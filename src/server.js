import "dotenv/config";
import express from "express";
import productsRouter from "./routes/products.js";
import { getMetricsSnapshot } from "./cache/cacheAside.js";
import { rateLimiter } from "./middleware/rateLimiter.js";
import { register, httpMetricsMiddleware } from "./metrics/prometheus.js";

const app = express();
app.use(express.json());
app.use(httpMetricsMiddleware);

// 100 requests per minute per IP, applied to all routes.
app.use(rateLimiter({ windowSeconds: 60, maxRequests: 100 }));

app.use("/", productsRouter);

// Simple JSON snapshot — quick to eyeball in a browser or curl.
app.get("/metrics", (req, res) => {
  res.json(getMetricsSnapshot());
});

// Prometheus-format metrics — scrape this from Prometheus/Grafana.
app.get("/metrics/prometheus", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`cache-showcase API listening on http://localhost:${PORT}`);
});
