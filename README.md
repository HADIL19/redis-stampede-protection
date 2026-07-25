# 🚀 redis-stampede-protection

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat&logo=express&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)

A Node.js + Redis + Postgres API implementing common backend caching patterns:
cache-aside reads, explicit invalidation on writes, cache stampede protection,
and a write-through variant for comparison.

## ✨ Features

- 🧠 **Cache-aside (lazy loading)** for reads: check Redis first, fall back to
  Postgres on a miss, populate the cache with a TTL.
- ♻️ **Explicit cache invalidation** on writes, so updates never serve stale data.
- 🐘 **Cache stampede / dogpile protection**: when a hot key expires, only one
  request rebuilds it (via a short-lived Redis lock); everyone else polls the
  cache briefly instead of all hammering the database at once.
- ✍️ **Write-through variant** for comparison, with a documented tradeoff (see below).
- 📊 **Observability**: a `/metrics` endpoint reporting cache hit/miss ratio and
  lock-wait count.

## 🏗️ Architecture

```
Client → Express route → Redis (cache-aside check)
                              │
                    hit ──────┘── return cached JSON
                              │
                    miss → acquire lock → Postgres query → populate cache → return
```

## 🔄 Request flow (cache-aside)

1. `GET /products/:id` checks Redis for `products:<id>`.
2. ✅ **Hit** → return immediately, no DB touched.
3. ❌ **Miss** → try to acquire `lock:products:<id>` (Redis `SET NX PX`).
   - Lock acquired → query Postgres, write result to Redis with a TTL, release lock.
   - Lock not acquired (another request is already rebuilding this key) → poll
     Redis for ~2 seconds instead of also querying Postgres.

This second part is what prevents a **thundering herd** 🐃: without it, a popular
key expiring under load causes every concurrent request to miss the cache at
once and slam the database simultaneously.

## ⚖️ Why cache-aside instead of write-through for the primary path

- **Cache-aside** only caches what's actually being read, and reads are far
  more frequent than writes for a product catalog — so we don't waste cache
  memory/writes on rows nobody is requesting.
- **Write-through** (implemented at `PUT /products/:id/write-through` for
  comparison) keeps the cache always warm immediately after a write, at the
  cost of a slower write path (every write pays a Redis round trip, whether
  or not anyone reads that row again soon).

> **Rule of thumb:** pick write-through when reads-after-write are common
> and writes are rare; pick cache-aside (with invalidation) when writes are
> comparatively rare and you don't want to pay caching cost for rarely-read rows.

## 🏁 Running it

```bash
docker compose up -d        # starts Redis + Postgres
cp .env.example .env
npm install
npm run seed                 # creates products table + sample rows
npm run dev
```

## 📡 Endpoints

| Method | Path                              | Behavior                                  |
|--------|-----------------------------------|--------------------------------------------|
| GET    | `/products`                       | List, cache-aside, TTL 15s                 |
| GET    | `/products/:id`                   | Single product, cache-aside, TTL 60s       |
| PUT    | `/products/:id`                   | Update + invalidate cache                  |
| PUT    | `/products/:id/write-through`     | Update + immediately repopulate cache      |
| GET    | `/metrics`                        | `{ hits, misses, lockWaits, total, hitRatio }` |

## 🧪 Verifying it works

```bash
# first call = miss, second = hit
curl localhost:3000/products/1
curl localhost:3000/products/1
curl localhost:3000/metrics

# update it, confirm the cache doesn't serve stale data
curl -X PUT localhost:3000/products/1 -H "Content-Type: application/json" -d '{"stock": 5}'
curl localhost:3000/products/1   # should show stock: 5 immediately
```

For a load-test showing the stampede protection under concurrency, try
[`autocannon`](https://github.com/mcollina/autocannon) against `/products/1`
right after it expires and confirm Postgres only gets one query, not N.

## 🔮 What's next

- Move lock/metrics logic into a reusable module if this pattern were used
  across many resource types.
- Push metrics to Prometheus instead of an in-memory counter (this resets on
  restart, which is fine for a demo, not for production).
- Add a Redis Cluster note for horizontal scaling considerations.

## 📚 Resources

- [Caching concepts explained](https://youtu.be/1XJG34mewts) — helped me understand the core ideas behind this project.