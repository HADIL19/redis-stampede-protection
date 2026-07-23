import "dotenv/config";
import express from "express";
import productsRouter from "./routes/products.js";
import { getMetricsSnapshot } from "./cache/cacheAside.js";
import { rateLimiter } from "./middleware/rateLimiter.js";

const app = express();
app.use(express.json());

// 100 requests per minute per IP, applied to all routes.
app.use(rateLimiter({ windowSeconds: 60, maxRequests: 100 }));

app.use("/", productsRouter);

// Observability: expose cache hit/miss ratio so you can confirm
// the caching is working, not just claim it is.
app.get("/metrics", (req, res) => {
  res.json(getMetricsSnapshot());
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`cache-showcase API listening on http://localhost:${PORT}`);
});
