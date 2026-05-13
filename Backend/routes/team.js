const express = require("express");
const router = express.Router();
const pool = require("../db");
const { verifyJwt, requireAdmin, requireSelfOrAdmin } = require("../middleware/auth");

async function ensureTeamOwnerColumns() {
  await pool.query("ALTER TABLE teams ADD COLUMN IF NOT EXISTS owner_email TEXT");
  await pool.query("ALTER TABLE teams ADD COLUMN IF NOT EXISTS user_id INTEGER");
  await pool.query("ALTER TABLE teams ADD COLUMN IF NOT EXISTS agent_id TEXT");
}

const MAX_TEAMS_PER_OWNER = 5;

// ➕ Create team — requires login; owner_email column now stores the caller's
// username (the column name is kept for backwards compatibility with existing
// data, but the value is the user's unique username, not an email).
router.post("/", requireSelfOrAdmin, async (req, res) => {
  const { name, agent_id } = req.body;
  const ownerEmail = String(
    req.headers["x-user-username"] || req.headers["x-user-email"] || req.body.owner_email || ""
  )
    .trim()
    .toLowerCase();
  const userId = req.headers["x-user-id"] || req.body.user_id || null;

  try {
    await ensureTeamOwnerColumns();

    // Enforce per-owner team cap (only when we can identify the owner)
    if (ownerEmail) {
      const countResult = await pool.query(
        "SELECT COUNT(*)::int AS count FROM teams WHERE LOWER(owner_email) = $1",
        [ownerEmail]
      );
      if (countResult.rows[0].count >= MAX_TEAMS_PER_OWNER) {
        return res.status(400).json({
          error: "Team limit reached. You can register a maximum of " + MAX_TEAMS_PER_OWNER + " teams.",
        });
      }
    }

    const result = await pool.query(
      "INSERT INTO teams (name, owner_email, user_id, agent_id) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, ownerEmail || null, userId || null, agent_id || null]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 📄 Get teams owned by the signed-in user (identity is derived from verified token)
router.get("/mine", requireSelfOrAdmin, async (req, res) => {
  const ownerEmail = String(
    req.headers["x-user-username"] || req.headers["x-user-email"] || ""
  )
    .trim()
    .toLowerCase();
  if (!ownerEmail) {
    return res.status(400).json({ error: "X-User-Username header required" });
  }
  try {
    await ensureTeamOwnerColumns();
    const result = await pool.query(
      "SELECT * FROM teams WHERE LOWER(owner_email) = $1 ORDER BY id DESC",
      [ownerEmail]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 📄 Get teams — admin-only (full list is sensitive enumeration)
router.get("/", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM teams");
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
