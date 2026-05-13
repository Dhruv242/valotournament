const express = require("express");
const router = express.Router();
const pool = require("../db");
const { verifyJwt, requireAdmin } = require("../middleware/auth");

// Ownership guard — caller must own the team they're adding a player to
async function requireTeamOwnership(req, res, next) {
  try {
    if (req.user.role === "admin") return next();
    const teamId = req.body.team_id || req.params.teamId;
    if (!teamId) return res.status(400).json({ error: "team_id required" });
    const result = await pool.query(
      "SELECT owner_email FROM teams WHERE id = $1",
      [teamId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Team not found" });
    const ownerName = String(result.rows[0].owner_email || "").toLowerCase();
    const tokenName = String(req.user.username || "").toLowerCase();
    if (!ownerName || ownerName !== tokenName) {
      return res.status(403).json({ error: "Not your team" });
    }
    next();
  } catch (err) {
    console.error("Ownership check error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ➕ Add player (VALIDATION + LIMIT + NO DUPLICATES)
router.post("/", verifyJwt, requireTeamOwnership, async (req, res) => {
  const { team_id, name, valorant_name, tag } = req.body;

  // 🔥 BASIC VALIDATION
  if (!team_id || !valorant_name || !tag) {
    return res.status(400).json({
      error: "team_id, valorant_name and tag are required",
    });
  }

  try {
    // 🔥 CHECK TEAM EXISTS
    const teamCheck = await pool.query(
      "SELECT id FROM teams WHERE id = $1",
      [team_id]
    );
    if (teamCheck.rows.length === 0) {
      return res.status(400).json({
        error: "Team does not exist",
      });
    }

    // 🔥 CHECK DUPLICATE PLAYER (same Riot ID)
    const duplicateCheck = await pool.query(
      "SELECT id FROM players WHERE valorant_name = $1 AND valorant_tag = $2",
      [valorant_name, tag]
    );
    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        error: "Player already registered (duplicate Valorant ID)",
      });
    }

    // 🔥 CHECK TEAM SIZE (MAX 6)
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM players WHERE team_id = $1",
      [team_id]
    );
    const count = parseInt(countResult.rows[0].count);
    if (count >= 6) {
      return res.status(400).json({
        error: "Max 6 players allowed per team",
      });
    }

    // ➕ INSERT PLAYER - FIXED COLUMN NAMES
    const result = await pool.query(
      `INSERT INTO players (team_id, full_name, valorant_name, valorant_tag)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [team_id, name || "", valorant_name, tag]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("❌ Add player error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 📄 Get ALL players — admin only (PII enumeration risk)
router.get("/", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM players ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Get players error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 📄 Get players of a specific team — must own the team or be admin
router.get("/:teamId", verifyJwt, async (req, res) => {
  const { teamId } = req.params;
  try {
    if (req.user.role !== "admin") {
      const teamRow = await pool.query(
        "SELECT owner_email FROM teams WHERE id = $1",
        [teamId]
      );
      if (!teamRow.rows.length) return res.status(404).json({ error: "Team not found" });
      const owner = String(teamRow.rows[0].owner_email || "").toLowerCase();
      const me = String(req.user.username || "").toLowerCase();
      if (owner !== me) return res.status(403).json({ error: "Not your team" });
    }

    const result = await pool.query(
      "SELECT * FROM players WHERE team_id = $1 ORDER BY id",
      [teamId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Get team players error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
