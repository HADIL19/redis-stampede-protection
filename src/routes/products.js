import { Router } from "express";
import pool from "../db/pool.js";
import redis from "../redisClient.js";
import { getWithCacheAside, invalidate } from "../cache/cacheAside.js";

const router = Router();

const TTL_PRODUCT = Number(process.env.CACHE_TTL_PRODUCT || 60);
const TTL_LIST = Number(process.env.CACHE_TTL_PRODUCT_LIST || 15);

// ---- READ: cache-aside pattern ----

router.get("/products", async (req, res) => {
  const key = "products:all";
  const products = await getWithCacheAside(key, TTL_LIST, async () => {
    const { rows } = await pool.query(
      "SELECT id, name, price, stock, updated_at FROM products ORDER BY id"
    );
    return rows;
  });
  res.json(products);
});

router.get("/products/:id", async (req, res) => {
  const { id } = req.params;
  const key = `products:${id}`;

  const product = await getWithCacheAside(key, TTL_PRODUCT, async () => {
    const { rows } = await pool.query(
      "SELECT id, name, price, stock, updated_at FROM products WHERE id = $1",
      [id]
    );
    return rows[0] || null;
  });

  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
});

// ---- WRITE (cache-aside side): update DB, then explicitly bust the cache ----
// This is the part most people forget: a stale cached product after an update
// is a very common real-world bug.

router.put("/products/:id", async (req, res) => {
  const { id } = req.params;
  const { price, stock } = req.body;

  const { rows } = await pool.query(
    `UPDATE products SET price = COALESCE($1, price),
                          stock = COALESCE($2, stock),
                          updated_at = now()
     WHERE id = $3
     RETURNING id, name, price, stock, updated_at`,
    [price, stock, id]
  );

  if (rows.length === 0) return res.status(404).json({ error: "Product not found" });

  // Bust both the individual product cache and the list cache, since the
  // list's contents are now stale too.
  await invalidate(`products:${id}`, "products:all");

  res.json(rows[0]);
});

// ---- WRITE-THROUGH variant, for comparison ----
// Instead of just invalidating, we write to the DB AND immediately
// re-populate the cache with the new value in the same request.
// Tradeoff: writes are a bit slower (extra Redis round trip on every write),
// but reads right after a write are guaranteed warm — no cache-miss penalty
// for the next reader. Good fit when reads-after-write are frequent and
// the write rate is much lower than the read rate.

router.put("/products/:id/write-through", async (req, res) => {
  const { id } = req.params;
  const { price, stock } = req.body;

  const { rows } = await pool.query(
    `UPDATE products SET price = COALESCE($1, price),
                          stock = COALESCE($2, stock),
                          updated_at = now()
     WHERE id = $3
     RETURNING id, name, price, stock, updated_at`,
    [price, stock, id]
  );

  if (rows.length === 0) return res.status(404).json({ error: "Product not found" });

  const updated = rows[0];
  await redis.set(`products:${id}`, JSON.stringify(updated), "EX", TTL_PRODUCT);
  await invalidate("products:all"); // list shape changed too broadly to write-through cheaply

  res.json(updated);
});

export default router;
