const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "postgres",
  user: process.env.DB_USER || "val_dk",
  password: process.env.DB_PASSWORD || "Val@123#321",
  database: process.env.DB_NAME || "val",
  port: 5432,
});

module.exports = pool;