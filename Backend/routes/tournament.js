const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const pool = require("../db");

const SECRET = process.env.JWT_SECRET;
if (!SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET required in production");
}

// Public: list of recent champions (for home carousel)
router.get("/champions", async (req, res) => {
  try {
    await pool.query("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner_team_id INTEGER");
    await pool.query("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP");

    const limit = Math.min(parseInt(req.query.limit || "10", 10) || 10, 25);

    const rows = await pool.query(
      `SELECT t.id   AS tournament_id,
              t.tournament_type,
              t.prize_pool,
              t.completed_at,
              w.id   AS winner_id,
              w.name AS winner_name,
              w.agent_id AS winner_agent_id
       FROM tournaments t
       JOIN teams w ON w.id = t.winner_team_id
       WHERE t.status = 'completed' AND t.winner_team_id IS NOT NULL
       ORDER BY t.completed_at DESC NULLS LAST, t.id DESC
       LIMIT $1`,
      [limit]
    );

    const champions = await Promise.all(
      rows.rows.map(async function expand(row) {
        const players = await pool.query(
          `SELECT * FROM players WHERE team_id = $1 ORDER BY id ASC`,
          [row.winner_id]
        );
        return {
          tournament_id: row.tournament_id,
          tournament_type: row.tournament_type,
          prize_pool: row.prize_pool,
          completed_at: row.completed_at,
          team: {
            id: row.winner_id,
            name: row.winner_name,
            agent_id: row.winner_agent_id,
          },
          players: players.rows,
        };
      })
    );

    res.json({ champions: champions });
  } catch (err) {
    console.error("Champions list error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Public: most recently completed tournament's champion (for home page)
router.get("/champion", async (req, res) => {
  try {
    await pool.query("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner_team_id INTEGER");
    await pool.query("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP");

    const champ = await pool.query(
      `SELECT t.*,
              w.id   AS winner_id,
              w.name AS winner_name,
              w.agent_id AS winner_agent_id
       FROM tournaments t
       LEFT JOIN teams w ON w.id = t.winner_team_id
       WHERE t.status = 'completed' AND t.winner_team_id IS NOT NULL
       ORDER BY t.completed_at DESC NULLS LAST, t.id DESC
       LIMIT 1`
    );

    if (!champ.rows.length) {
      return res.json({ champion: null });
    }

    const row = champ.rows[0];
    const players = await pool.query(
      `SELECT * FROM players WHERE team_id = $1 ORDER BY id ASC`,
      [row.winner_id]
    );

    res.json({
      champion: {
        tournament_id: row.id,
        tournament_type: row.tournament_type,
        prize_pool: row.prize_pool,
        completed_at: row.completed_at,
        team: {
          id: row.winner_id,
          name: row.winner_name,
          agent_id: row.winner_agent_id,
        },
        players: players.rows,
      },
    });
  } catch (err) {
    console.error("Champion fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get tournament details by team ID (PLAYER AUTHORIZATION)
router.get("/:team_id", async (req, res) => {
  try {
    const { team_id } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, SECRET || "dev-only-do-not-use");
    } catch (err) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Get team details
    const teamResult = await pool.query(
      `SELECT * FROM teams WHERE id=$1`,
      [team_id]
    );

    if (teamResult.rows.length === 0) {
      return res.status(404).json({ error: "Team not found" });
    }

    const team = teamResult.rows[0];

    // AUTHORIZATION: Players can only see their own teams
    if (decoded.role !== 'admin' && decoded.username !== team.owner_email) {
      return res.status(403).json({ 
        error: "Access denied. You can only view your own team's tournament." 
      });
    }

    if (!team.tournament_id) {
      return res.status(404).json({ error: "Team not assigned to tournament yet" });
    }

    // Get tournament details
    const tournament = await pool.query(
      `SELECT * FROM tournaments WHERE id=$1`,
      [team.tournament_id]
    );

    if (tournament.rows.length === 0) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    // Get all teams in tournament
    const teams = await pool.query(
      `SELECT t.*, 
        (SELECT COUNT(*) FROM players WHERE team_id=t.id) as player_count
       FROM teams t
       WHERE t.tournament_id=$1
       ORDER BY t.tournament_position ASC`,
      [team.tournament_id]
    );

    // Get all matches (FIXED: using round and position)
    const matches = await pool.query(
      `SELECT m.*, 
        t1.name as team1_name,
        t2.name as team2_name,
        tw.name as winner_name
       FROM matches m
       LEFT JOIN teams t1 ON t1.id=m.team1_id
       LEFT JOIN teams t2 ON t2.id=m.team2_id
       LEFT JOIN teams tw ON tw.id=m.winner_id
       WHERE m.tournament_id=$1
       ORDER BY m.round ASC, m.position ASC, m.id ASC`,
      [team.tournament_id]
    );

    // Get players for this specific team only (privacy)
    const players = await pool.query(
      `SELECT * FROM players WHERE team_id=$1 ORDER BY id ASC`,
      [team_id]
    );

    res.json({
      tournament: tournament.rows[0],
      team: team,
      teams: teams.rows,
      matches: matches.rows,
      players: players.rows,
    });
  } catch (err) {
    console.error("Tournament fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get tournament by type (for dashboard lookup)
router.get("/lookup/:tournament_type", async (req, res) => {
  try {
    const { tournament_type } = req.params;
    const { team_id } = req.query;
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, SECRET || "dev-only-do-not-use");
    } catch (err) {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (!team_id) {
      return res.status(400).json({ error: "team_id required" });
    }

    // Get team and verify ownership
    const teamResult = await pool.query(
      `SELECT * FROM teams WHERE id=$1`,
      [team_id]
    );

    if (teamResult.rows.length === 0) {
      return res.status(404).json({ error: "Team not found" });
    }

    const team = teamResult.rows[0];

    // AUTHORIZATION: Players can only lookup their own teams
    if (decoded.role !== 'admin' && decoded.username !== team.owner_email) {
      return res.status(403).json({ 
        error: "Access denied. You can only view your own team's tournament." 
      });
    }

    if (!team.tournament_id) {
      return res.status(404).json({ error: "Team not assigned to tournament yet" });
    }

    // Forward to the main route
    const tournament = await pool.query(
      `SELECT * FROM tournaments WHERE id=$1`,
      [team.tournament_id]
    );

    if (tournament.rows.length === 0) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    const teams = await pool.query(
      `SELECT t.*, 
        (SELECT COUNT(*) FROM players WHERE team_id=t.id) as player_count
       FROM teams t
       WHERE t.tournament_id=$1
       ORDER BY t.tournament_position ASC`,
      [team.tournament_id]
    );

    const matches = await pool.query(
      `SELECT m.*, 
        t1.name as team1_name,
        t2.name as team2_name,
        tw.name as winner_name
       FROM matches m
       LEFT JOIN teams t1 ON t1.id=m.team1_id
       LEFT JOIN teams t2 ON t2.id=m.team2_id
       LEFT JOIN teams tw ON tw.id=m.winner_id
       WHERE m.tournament_id=$1
       ORDER BY m.round ASC, m.position ASC, m.id ASC`,
      [team.tournament_id]
    );

    const players = await pool.query(
      `SELECT * FROM players WHERE team_id=$1 ORDER BY id ASC`,
      [team_id]
    );

    res.json({
      tournament: tournament.rows[0],
      team: team,
      teams: teams.rows,
      matches: matches.rows,
      players: players.rows,
    });
  } catch (err) {
    console.error("Tournament lookup error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
