const express = require("express");
const router = express.Router();
const net = require("net");
const pool = require("../db");

function smtpCommand(socket, command) {
  socket.write(command + "\r\n");
}

function sendMailHogEmail(to, subject, text) {
  return new Promise((resolve) => {
    if (!to) {
      resolve(false);
      return;
    }

    const host = process.env.MAILHOG_HOST || "mailhog";
    const port = Number(process.env.MAILHOG_SMTP_PORT || 1025);
    const from = process.env.MAIL_FROM || "fixtures@valrift.local";
    const socket = net.createConnection({ host, port });
    const steps = [
      "HELO valrift.local",
      "MAIL FROM:<" + from + ">",
      "RCPT TO:<" + to + ">",
      "DATA",
      [
        "From: VALRIFT Champions <" + from + ">",
        "To: " + to,
        "Subject: " + subject,
        "",
        text,
        ".",
      ].join("\r\n"),
      "QUIT",
    ];
    let index = 0;

    socket.setTimeout(3000);
    socket.on("data", () => {
      if (index < steps.length) {
        smtpCommand(socket, steps[index]);
        index += 1;
      }
    });
    socket.on("error", (err) => {
      console.warn("MailHog email skipped:", err.message);
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("close", () => resolve(true));
  });
}

async function notifyReadyMatch(matchId) {
  const matchRes = await pool.query(
    `SELECT m.*, t1.name AS team1_name, t1.owner_email AS team1_email,
            t2.name AS team2_name, t2.owner_email AS team2_email
     FROM matches m
     LEFT JOIN teams t1 ON t1.id=m.team1_id
     LEFT JOIN teams t2 ON t2.id=m.team2_id
     WHERE m.id=$1`,
    [matchId]
  );

  if (!matchRes.rows.length) {
    return;
  }

  const match = matchRes.rows[0];
  if (!match.team1_id || !match.team2_id) {
    return;
  }

  const scheduledAt = match.scheduled_time
    ? new Date(match.scheduled_time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : "Schedule pending";
  const subject = "VALRIFT next knockout match: " + match.team1_name + " vs " + match.team2_name;
  const body =
    "Your team has advanced. Your next knockout match is ready.\n\n" +
    "Match: #" + match.id + "\n" +
    "Opponent: " + match.team1_name + " vs " + match.team2_name + "\n" +
    "Time: " + scheduledAt + "\n\n" +
    "Good luck.";

  await Promise.all([
    sendMailHogEmail(match.team1_email, subject, body),
    sendMailHogEmail(match.team2_email, subject, body),
  ]);
}


/**
 * 🔥 GET TOURNAMENT DATA FOR A SPECIFIC PAID TEAM
 */
router.get("/by-team/:teamId", async (req, res) => {
  try {
    const { teamId } = req.params;

    const teamRes = await pool.query(
      "SELECT * FROM teams WHERE id=$1",
      [teamId]
    );

    if (!teamRes.rows.length || !teamRes.rows[0].tournament_id) {
      return res.json({ tournament: null, teams: [], matches: [] });
    }

    const tournamentId = teamRes.rows[0].tournament_id;

    const [tournament, teams, matches] = await Promise.all([
      pool.query("SELECT * FROM tournaments WHERE id=$1", [tournamentId]),
      pool.query("SELECT * FROM teams WHERE tournament_id=$1 ORDER BY id ASC", [tournamentId]),
      pool.query(
        `SELECT * FROM matches
         WHERE tournament_id=$1
         ORDER BY bracket_round ASC, bracket_position ASC, id ASC`,
        [tournamentId]
      ),
    ]);

    res.json({
      tournament: tournament.rows[0] || null,
      teams: teams.rows,
      matches: matches.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 🔥 GET CURRENT ACTIVE TOURNAMENT (AUTO)
 * No ID needed — always returns latest running/waiting
 */
router.get("/current/:type", async (req, res) => {
  try {
    const { type } = req.params;

    const result = await pool.query(
      `SELECT * FROM tournaments 
       WHERE type=$1 AND status IN ('waiting','running')
       ORDER BY id DESC LIMIT 1`,
      [type]
    );

    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/**
 * 🔥 GET MATCHES FOR CURRENT TOURNAMENT (AUTO)
 */
router.get("/matches/:type", async (req, res) => {
  try {
    const { type } = req.params;

    const tRes = await pool.query(
      `SELECT id FROM tournaments 
       WHERE type=$1 AND status IN ('waiting','running')
       ORDER BY id DESC LIMIT 1`,
      [type]
    );

    if (!tRes.rows.length) {
      return res.json([]);
    }

    const tournamentId = tRes.rows[0].id;

    const matches = await pool.query(
      `SELECT * FROM matches 
       WHERE tournament_id=$1 
       ORDER BY bracket_round ASC, bracket_position ASC, id ASC`,
      [tournamentId]
    );

    res.json(matches.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/**
 * 🔥 GET TEAMS FOR CURRENT TOURNAMENT
 */
router.get("/teams/:type", async (req, res) => {
  try {
    const { type } = req.params;

    const tRes = await pool.query(
      `SELECT id FROM tournaments 
       WHERE type=$1 AND status IN ('waiting','running')
       ORDER BY id DESC LIMIT 1`,
      [type]
    );

    if (!tRes.rows.length) {
      return res.json([]);
    }

    const tournamentId = tRes.rows[0].id;

    const teams = await pool.query(
      `SELECT * FROM teams WHERE tournament_id=$1`,
      [tournamentId]
    );

    res.json(teams.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/**
 * 🔥 ADMIN: START MATCH
 */
router.post("/start-match", async (req, res) => {
  try {
    const { match_id } = req.body;

    if (!match_id) {
      return res.status(400).json({
        error: "match_id required",
      });
    }

    await pool.query(
      `UPDATE matches 
       SET match_status='live' 
       WHERE id=$1`,
      [match_id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/**
 * 🔥 ADMIN: SET WINNER + UPDATE WINS + CHECK FINAL WINNER
 */
router.post("/set-winner", async (req, res) => {
  try {
    const { match_id, winner_id } = req.body;

    if (!match_id || !winner_id) {
      return res.status(400).json({
        error: "match_id and winner_id required",
      });
    }

    // 🔥 1. COMPLETE MATCH
    const matchRes = await pool.query(
      `UPDATE matches 
       SET match_status='completed', winner_id=$1 
       WHERE id=$2
       RETURNING tournament_id, next_match_id, next_match_slot`,
      [winner_id, match_id]
    );

    const completedMatch = matchRes.rows[0];
    const tournamentId = completedMatch.tournament_id;

    // 🔥 2. UPDATE TEAM WINS
    await pool.query(
      `UPDATE teams 
       SET wins = wins + 1 
       WHERE id=$1`,
      [winner_id]
    );

    // 🔥 3. ADVANCE WINNER INTO NEXT KNOCKOUT MATCH
    if (completedMatch.next_match_id) {
      const slotColumn = Number(completedMatch.next_match_slot) === 2 ? "team2_id" : "team1_id";
      await pool.query(
        `UPDATE matches SET ${slotColumn}=$1 WHERE id=$2`,
        [winner_id, completedMatch.next_match_id]
      );
      await notifyReadyMatch(completedMatch.next_match_id);
    }

    // 🔥 4. CHECK IF ALL MATCHES COMPLETED
    const pending = await pool.query(
      `SELECT COUNT(*) FROM matches 
       WHERE tournament_id=$1 AND match_status!='completed'`,
      [tournamentId]
    );

    if (parseInt(pending.rows[0].count) === 0) {
      // 🔥 5. DECLARE FINAL WINNER
      const finalWinner = await pool.query(
        "SELECT * FROM teams WHERE id=$1",
        [winner_id]
      );

      // 🔥 6. UPDATE TOURNAMENT STATUS
      await pool.query(
        `UPDATE tournaments 
         SET status='completed' 
         WHERE id=$1`,
        [tournamentId]
      );

      return res.json({
        success: true,
        tournament_winner: finalWinner.rows[0],
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("SET WINNER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
