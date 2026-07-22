import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://demo:demo@localhost:5432/cache_showcase",
});

export default pool;
