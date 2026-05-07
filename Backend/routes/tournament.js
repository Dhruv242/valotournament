const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const pool = require("../db");

const SECRET = process.env.JWT_SECRET || "supersecret";

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
      decoded = jwt.verify(token, SECRET);
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
    if (decoded.role !== 'admin' && decoded.email !== team.owner_email) {
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
      decoded = jwt.verify(token, SECRET);
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
    if (decoded.role !== 'admin' && decoded.email !== team.owner_email) {
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
