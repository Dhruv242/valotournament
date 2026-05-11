const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Razorpay = require("razorpay");
const pool = require("../db");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_JtXZTgJYqTJqBX",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "zcmQgXZuM2VvTDqKzPSRwKN6",
});

// Create Razorpay order
router.post("/create-order", async (req, res) => {
  try {
    const { amount, currency = "INR", team_id, tournament_type } = req.body;

    if (!amount || !team_id || !tournament_type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const options = {
      amount: amount * 100,
      currency,
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);

    await pool.query(
      `INSERT INTO payments (team_id, order_id, amount, currency, status)
       VALUES ($1, $2, $3, $4, 'created')`,
      [team_id, order.id, amount, currency]
    );

    res.json(order);
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Verify payment and assign team to tournament
router.post("/verify-payment", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, team_id, tournament_type } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !team_id || !tournament_type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "zcmQgXZuM2VvTDqKzPSRwKN6")
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      await pool.query(
        `UPDATE payments SET status='failed' WHERE order_id=$1`,
        [razorpay_order_id]
      );
      return res.status(400).json({ error: "Invalid signature" });
    }

    await pool.query(
      `UPDATE payments 
       SET status='completed', payment_id=$1, razorpay_signature=$2, completed_at=NOW()
       WHERE order_id=$3`,
      [razorpay_payment_id, razorpay_signature, razorpay_order_id]
    );

    // Find or create tournament
    let tournament = await pool.query(
      `SELECT * FROM tournaments 
       WHERE tournament_type=$1 AND status='waiting' AND current_teams < max_teams
       ORDER BY created_at ASC LIMIT 1`,
      [tournament_type]
    );

    if (tournament.rows.length === 0) {
      const prizePool = tournament_type === "amateur" ? 1000 : 2000;
      const entryFee = tournament_type === "amateur" ? 250 : 500;

      const newTournament = await pool.query(
        `INSERT INTO tournaments (tournament_type, status, max_teams, current_teams, prize_pool, entry_fee)
         VALUES ($1, 'waiting', 8, 0, $2, $3)
         RETURNING *`,
        [tournament_type, prizePool, entryFee]
      );
      tournament = newTournament;
    }

    const tournamentId = tournament.rows[0].id;
    const currentTeams = tournament.rows[0].current_teams;
    const position = currentTeams + 1;

    await pool.query(
      `UPDATE teams 
       SET tournament_id=$1, tournament_position=$2
       WHERE id=$3`,
      [tournamentId, position, team_id]
    );

    await pool.query(
      `UPDATE tournaments 
       SET current_teams=current_teams+1 
       WHERE id=$1`,
      [tournamentId]
    );

    const updatedTournament = await pool.query(
      `SELECT * FROM tournaments WHERE id=$1`,
      [tournamentId]
    );

    // Check if tournament is full (8 teams)
    if (updatedTournament.rows[0].current_teams === 8) {
      await pool.query(
        `UPDATE tournaments SET status='running', started_at=NOW() WHERE id=$1`,
        [tournamentId]
      );

      // Create quarterfinal matches (4 matches)
      const teams = await pool.query(
        `SELECT id FROM teams WHERE tournament_id=$1 ORDER BY tournament_position ASC`,
        [tournamentId]
      );

      const teamIds = teams.rows.map((t) => t.id);

      // Quarterfinals: Match teams (1v8, 2v7, 3v6, 4v5)
      const quarterfinalPairs = [
        [teamIds[0], teamIds[7]], // Match 1: Team 1 vs Team 8
        [teamIds[1], teamIds[6]], // Match 2: Team 2 vs Team 7
        [teamIds[2], teamIds[5]], // Match 3: Team 3 vs Team 6
        [teamIds[3], teamIds[4]], // Match 4: Team 4 vs Team 5
      ];

      const baseTime = new Date();
      baseTime.setHours(baseTime.getHours() + 2);

      // Create quarterfinal matches (round 1)
      for (let i = 0; i < quarterfinalPairs.length; i++) {
        const matchTime = new Date(baseTime.getTime() + i * 90 * 60 * 1000);
        await pool.query(
          `INSERT INTO matches 
           (tournament_id, team1_id, team2_id, status, match_status, is_scheduled, scheduled_time, round, position)
           VALUES ($1, $2, $3, 'pending', 'scheduled', true, $4, 1, $5)`,
          [tournamentId, quarterfinalPairs[i][0], quarterfinalPairs[i][1], matchTime, i + 1]
        );
      }

      // Create semifinal matches (round 2) - placeholders
      for (let i = 0; i < 2; i++) {
        const matchTime = new Date(baseTime.getTime() + (4 + i) * 90 * 60 * 1000);
        await pool.query(
          `INSERT INTO matches 
           (tournament_id, status, match_status, is_scheduled, scheduled_time, round, position)
           VALUES ($1, 'pending', 'scheduled', true, $2, 2, $3)`,
          [tournamentId, matchTime, i + 1]
        );
      }

      // Create final match (round 3) - placeholder
      const finalMatchTime = new Date(baseTime.getTime() + 6 * 90 * 60 * 1000);
      await pool.query(
        `INSERT INTO matches 
         (tournament_id, status, match_status, is_scheduled, scheduled_time, round, position)
         VALUES ($1, 'pending', 'scheduled', true, $2, 3, 1)`,
        [tournamentId, finalMatchTime]
      );
    }

    res.json({
      success: true,
      message: "Payment verified and team registered",
      tournament_id: tournamentId,
      position: position,
    });
  } catch (err) {
    console.error("Verify payment error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;