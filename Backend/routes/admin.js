const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAdmin } = require("../middleware/auth");

// Get all tournaments with teams and players
router.get("/tournaments/overview", requireAdmin, async (req, res) => {
  try {
    const tournaments = await pool.query(`
      SELECT * FROM tournaments 
      ORDER BY created_at DESC, id DESC
    `);

    const tournamentsWithDetails = await Promise.all(
      tournaments.rows.map(async (tournament) => {
        const teams = await pool.query(`
          SELECT 
            t.*,
            (SELECT COUNT(*) FROM players WHERE team_id = t.id) as player_count,
            (SELECT status FROM payments WHERE team_id = t.id ORDER BY id DESC LIMIT 1) as payment_status
          FROM teams t
          WHERE t.tournament_id = $1
          ORDER BY t.tournament_position ASC
        `, [tournament.id]);

        const teamsWithPlayers = await Promise.all(
          teams.rows.map(async (team) => {
            const players = await pool.query(`
              SELECT * FROM players 
              WHERE team_id = $1 
              ORDER BY id ASC
            `, [team.id]);

            return {
              ...team,
              players: players.rows
            };
          })
        );

        // FIXED: Using round and position instead of bracket_round and bracket_position
        const matches = await pool.query(`
          SELECT 
            m.*,
            t1.name as team1_name,
            t2.name as team2_name,
            tw.name as winner_name
          FROM matches m
          LEFT JOIN teams t1 ON t1.id = m.team1_id
          LEFT JOIN teams t2 ON t2.id = m.team2_id
          LEFT JOIN teams tw ON tw.id = m.winner_id
          WHERE m.tournament_id = $1
          ORDER BY m.round ASC, m.position ASC, m.id ASC
        `, [tournament.id]);

        return {
          ...tournament,
          teams: teamsWithPlayers,
          matches: matches.rows,
          total_teams: teams.rows.length,
          total_players: teamsWithPlayers.reduce((sum, team) => sum + team.players.length, 0)
        };
      })
    );

    res.json(tournamentsWithDetails);
  } catch (err) {
    console.error("Admin overview error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get all teams (not in a tournament yet)
router.get("/teams/unassigned", requireAdmin, async (req, res) => {
  try {
    const teams = await pool.query(`
      SELECT 
        t.*,
        (SELECT COUNT(*) FROM players WHERE team_id = t.id) as player_count,
        (SELECT status FROM payments WHERE team_id = t.id ORDER BY id DESC LIMIT 1) as payment_status
      FROM teams t
      WHERE t.tournament_id IS NULL
      ORDER BY t.created_at DESC
    `);

    const teamsWithPlayers = await Promise.all(
      teams.rows.map(async (team) => {
        const players = await pool.query(`
          SELECT * FROM players 
          WHERE team_id = $1 
          ORDER BY id ASC
        `, [team.id]);

        return {
          ...team,
          players: players.rows
        };
      })
    );

    res.json(teamsWithPlayers);
  } catch (err) {
    console.error("Unassigned teams error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get all users — phone is admin-only, never exposed in public APIs.
router.get("/users", requireAdmin, async (req, res) => {
  try {
    const users = await pool.query(`
      SELECT
        id,
        username,
        phone,
        role,
        created_at,
        (SELECT COUNT(*) FROM teams WHERE LOWER(owner_email) = LOWER(users.username))::int AS team_count
      FROM users
      ORDER BY created_at DESC
    `);

    res.json(users.rows);
  } catch (err) {
    console.error("Users fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: full payments history (with team + owner context)
router.get("/payments", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.id,
        p.team_id,
        t.name AS team_name,
        t.owner_email,
        p.order_id,
        p.tr,
        p.submitted_utr,
        p.amount,
        p.currency,
        p.status,
        p.tournament_type,
        p.created_at,
        p.submitted_at,
        p.verified_at,
        p.verified_by,
        p.completed_at,
        p.rejection_reason
      FROM payments p
      LEFT JOIN teams t ON t.id = p.team_id
      ORDER BY p.created_at DESC, p.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Admin payments error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: pending payments queue — what the admin actually clears.
// Includes the screenshot so they can eyeball it before checking the bank.
router.get("/payments/pending", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.id,
        p.team_id,
        t.name AS team_name,
        t.owner_email,
        p.order_id,
        p.tr,
        p.submitted_utr,
        p.screenshot_data_url,
        p.amount,
        p.tournament_type,
        p.created_at,
        p.submitted_at
      FROM payments p
      LEFT JOIN teams t ON t.id = p.team_id
      WHERE p.status = 'submitted'
      ORDER BY p.submitted_at ASC, p.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Pending payments error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get statistics
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM tournaments) as total_tournaments,
        (SELECT COUNT(*) FROM tournaments WHERE status = 'waiting') as waiting_tournaments,
        (SELECT COUNT(*) FROM tournaments WHERE status = 'running') as running_tournaments,
        (SELECT COUNT(*) FROM tournaments WHERE status = 'completed') as completed_tournaments,
        (SELECT COUNT(*) FROM teams) as total_teams,
        (SELECT COUNT(*) FROM teams WHERE tournament_id IS NULL) as unassigned_teams,
        (SELECT COUNT(*) FROM players) as total_players,
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM matches) as total_matches,
        (SELECT COUNT(*) FROM matches WHERE match_status = 'completed') as completed_matches
    `);

    res.json(stats.rows[0]);
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

async function ensureTournamentResultColumns() {
  await pool.query("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner_team_id INTEGER");
  await pool.query("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP");
}

// === party_id feature ====================================================
// Drop this column + the route below to revert the feature.
async function ensurePartyIdColumn() {
  await pool.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS party_id TEXT");
}

// Admin action: set or clear the Valorant custom-lobby code for a match.
// Empty/whitespace clears it. Trimmed and capped at 32 chars to keep the
// UI tidy.
router.post("/match/party-id", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.body.match_id);
    if (!matchId) return res.status(400).json({ error: "match_id required" });
    const raw = String(req.body.party_id || "").trim().slice(0, 32);
    const partyId = raw === "" ? null : raw;

    await ensurePartyIdColumn();
    const result = await pool.query(
      "UPDATE matches SET party_id = $1 WHERE id = $2 RETURNING *",
      [partyId, matchId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Match not found" });
    res.json({ success: true, match: result.rows[0] });
  } catch (err) {
    console.error("Set party_id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Admin action: Schedule a match (set scheduled_time)
router.post("/match/schedule", requireAdmin, async (req, res) => {
  try {
    const { match_id, scheduled_time } = req.body;
    if (!match_id || !scheduled_time) {
      return res.status(400).json({ error: "match_id and scheduled_time required" });
    }

    const result = await pool.query(
      `UPDATE matches
       SET scheduled_time = $1, is_scheduled = true
       WHERE id = $2
       RETURNING *`,
      [scheduled_time, match_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Match not found" });
    }

    res.json({ success: true, message: "Match scheduled", match: result.rows[0] });
  } catch (err) {
    console.error("Schedule match error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Admin action: Start a match
router.post("/match/start", requireAdmin, async (req, res) => {
  try {
    const { match_id } = req.body;

    if (!match_id) {
      return res.status(400).json({ error: "match_id required" });
    }

    await pool.query(
      `UPDATE matches SET match_status='live', status='live' WHERE id=$1`,
      [match_id]
    );

    res.json({ success: true, message: "Match started" });
  } catch (err) {
    console.error("Start match error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Admin action: Set match winner — also advances the winner into the next round
// and closes the tournament when the final is decided.
router.post("/match/set-winner", requireAdmin, async (req, res) => {
  try {
    const { match_id, winner_id } = req.body;

    if (!match_id || !winner_id) {
      return res.status(400).json({ error: "match_id and winner_id required" });
    }

    await ensureTournamentResultColumns();

    // Mark current match completed
    const result = await pool.query(
      `UPDATE matches
       SET match_status='completed', status='completed', winner_id=$1
       WHERE id=$2
       RETURNING *`,
      [winner_id, match_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Match not found" });
    }

    const completedMatch = result.rows[0];
    const { tournament_id, round, position } = completedMatch;

    // 8-team single-elim bracket advancement:
    //   QF (round 1) pos 1 -> SF (round 2) pos 1 / team1
    //   QF pos 2          -> SF pos 1 / team2
    //   QF pos 3          -> SF pos 2 / team1
    //   QF pos 4          -> SF pos 2 / team2
    //   SF pos 1          -> Final (round 3) pos 1 / team1
    //   SF pos 2          -> Final pos 1 / team2
    let nextRound = null;
    let nextPosition = null;
    let nextSlot = null; // "team1_id" or "team2_id"

    if (round === 1) {
      nextRound = 2;
      nextPosition = Math.ceil(position / 2);
      nextSlot = position % 2 === 1 ? "team1_id" : "team2_id";
    } else if (round === 2) {
      nextRound = 3;
      nextPosition = 1;
      nextSlot = position === 1 ? "team1_id" : "team2_id";
    }

    let advancedMatch = null;
    if (nextRound && nextSlot) {
      const adv = await pool.query(
        `UPDATE matches
         SET ${nextSlot} = $1
         WHERE tournament_id = $2 AND round = $3 AND position = $4
         RETURNING *`,
        [winner_id, tournament_id, nextRound, nextPosition]
      );
      advancedMatch = adv.rows[0] || null;
    }

    // If the FINAL just ended, close the tournament out
    let tournamentClosed = false;
    if (round === 3) {
      await pool.query(
        `UPDATE tournaments
         SET status = 'completed',
             winner_team_id = $1,
             completed_at = NOW()
         WHERE id = $2`,
        [winner_id, tournament_id]
      );
      tournamentClosed = true;
    }

    res.json({
      success: true,
      message: "Winner set",
      match: completedMatch,
      advanced: advancedMatch,
      tournament_completed: tournamentClosed,
    });
  } catch (err) {
    console.error("Set winner error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;