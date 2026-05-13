const { Pool } = require("pg");

// Required envs. In production, missing = boot abort (handled in index.js).
const host = process.env.DB_HOST || "postgres";
const user = process.env.DB_USER || "val_dk";
const password = process.env.DB_PASSWORD;       // never default in prod
const database = process.env.DB_NAME || "val";
const port = Number(process.env.DB_PORT || 5432);

// SSL config — required for RDS. Set DB_SSL=true (or DB_SSL=require) when
// connecting to managed Postgres so traffic is encrypted in transit.
const useSsl =
  String(process.env.DB_SSL || "").toLowerCase() === "true" ||
  String(process.env.DB_SSL || "").toLowerCase() === "require";

const pool = new Pool({
  host,
  user,
  password,
  database,
  port,
  // Pool limits — prevents one client from exhausting the DB connections
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

module.exports = pool;
