import pool from "./pool.js";

const SAMPLE_PRODUCTS = [
  ["Mechanical Keyboard", 129.99, 42],
  ["Ultrawide Monitor", 549.0, 15],
  ["Wireless Mouse", 39.99, 120],
  ["Standing Desk", 399.5, 8],
  ["USB-C Dock", 89.0, 60],
];

async function seed() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM products");
  if (rows[0].count === 0) {
    for (const [name, price, stock] of SAMPLE_PRODUCTS) {
      await pool.query(
        "INSERT INTO products (name, price, stock) VALUES ($1, $2, $3)",
        [name, price, stock]
      );
    }
    console.log(`Seeded ${SAMPLE_PRODUCTS.length} products.`);
  } else {
    console.log("Products table already has data, skipping seed.");
  }

  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
