const express = require("express");
const router = express.Router();
const pool = require("../db");

async function ensureTeamOwnerColumns() {
  await pool.query("ALTER TABLE teams ADD COLUMN IF NOT EXISTS owner_email TEXT");
  await pool.query("ALTER TABLE teams ADD COLUMN IF NOT EXISTS user_id INTEGER");
}

// ➕ Create team
router.post("/", async (req, res) => {
  const { name } = req.body;
  const ownerEmail = String(req.headers["x-user-email"] || req.body.owner_email || "").trim().toLowerCase();
  const userId = req.headers["x-user-id"] || req.body.user_id || null;

  try {
    await ensureTeamOwnerColumns();

    const result = await pool.query(
      "INSERT INTO teams (name, owner_email, user_id) VALUES ($1, $2, $3) RETURNING *",
      [name, ownerEmail || null, userId || null]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 📄 Get teams
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM teams");
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
