const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const net = require("net");

const razorpay = require("../razorpay");
const pool = require("../db");

async function ensureBracketColumns() {
  await pool.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS bracket_round INTEGER DEFAULT 1");
  await pool.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS bracket_position INTEGER DEFAULT 1");
  await pool.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS next_match_id INTEGER");
  await pool.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS next_match_slot INTEGER");
  await pool.query("ALTER TABLE teams ADD COLUMN IF NOT EXISTS owner_email TEXT");
}

function nextWeekendSlots(count) {
  const slots = [];
  const cursor = new Date();
  cursor.setSeconds(0, 0);

  while (slots.length < count) {
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(18, 0, 0, 0);

    const day = cursor.getDay();
    if (![5, 6, 0].includes(day)) {
      continue;
    }

    while (slots.length < count && cursor.getHours() < 24) {
      slots.push(new Date(cursor));
      cursor.setMinutes(cursor.getMinutes() + 90);
    }
  }

  return slots;
}

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

async function notifyMatchTeams(match, teamsById) {
  const team1 = teamsById.get(Number(match.team1_id));
  const team2 = teamsById.get(Number(match.team2_id));
  const scheduledAt = match.scheduled_time
    ? new Date(match.scheduled_time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : "Schedule pending";
  const subject = "VALRIFT match scheduled: " + (team1 ? team1.name : "TBD") + " vs " + (team2 ? team2.name : "TBD");
  const body =
    "Your knockout match is scheduled.\n\n" +
    "Tournament: #" + match.tournament_id + "\n" +
    "Match: #" + match.id + "\n" +
    "Opponent: " +
    (team1 && team2 ? team1.name + " vs " + team2.name : "TBD") +
    "\nTime: " + scheduledAt + "\n\n" +
    "Winner advances automatically after admin records the result.";

  await Promise.all([
    team1 ? sendMailHogEmail(team1.owner_email, subject, body) : Promise.resolve(false),
    team2 ? sendMailHogEmail(team2.owner_email, subject, body) : Promise.resolve(false),
  ]);
}

async function createKnockoutBracket(tournamentId) {
  await ensureBracketColumns();

  const existing = await pool.query(
    "SELECT id FROM matches WHERE tournament_id=$1 LIMIT 1",
    [tournamentId]
  );

  if (existing.rows.length) {
    console.log("⚠️ Matches already exist, skipping...");
    return;
  }

  const teams = await pool.query(
    "SELECT id, name, owner_email FROM teams WHERE tournament_id=$1 ORDER BY id ASC",
    [tournamentId]
  );

  const teamRows = teams.rows;
  const slots = nextWeekendSlots(5);

  if (teamRows.length < 6) {
    return;
  }

  const m1 = await pool.query(
    `INSERT INTO matches
     (tournament_id, team1_id, team2_id, status, match_status, is_scheduled, scheduled_time, bracket_round, bracket_position)
     VALUES ($1,$2,$3,'pending','scheduled', true, $4, 1, 1)
     RETURNING *`,
    [tournamentId, teamRows[2].id, teamRows[5].id, slots[0]]
  );

  const m2 = await pool.query(
    `INSERT INTO matches
     (tournament_id, team1_id, team2_id, status, match_status, is_scheduled, scheduled_time, bracket_round, bracket_position)
     VALUES ($1,$2,$3,'pending','scheduled', true, $4, 1, 2)
     RETURNING *`,
    [tournamentId, teamRows[3].id, teamRows[4].id, slots[1]]
  );

  const semi1 = await pool.query(
    `INSERT INTO matches
     (tournament_id, team1_id, team2_id, status, match_status, is_scheduled, scheduled_time, bracket_round, bracket_position)
     VALUES ($1,$2,NULL,'pending','scheduled', true, $3, 2, 1)
     RETURNING *`,
    [tournamentId, teamRows[0].id, slots[2]]
  );

  const semi2 = await pool.query(
    `INSERT INTO matches
     (tournament_id, team1_id, team2_id, status, match_status, is_scheduled, scheduled_time, bracket_round, bracket_position)
     VALUES ($1,$2,NULL,'pending','scheduled', true, $3, 2, 2)
     RETURNING *`,
    [tournamentId, teamRows[1].id, slots[3]]
  );

  const final = await pool.query(
    `INSERT INTO matches
     (tournament_id, team1_id, team2_id, status, match_status, is_scheduled, scheduled_time, bracket_round, bracket_position)
     VALUES ($1,NULL,NULL,'pending','scheduled', true, $2, 3, 1)
     RETURNING *`,
    [tournamentId, slots[4]]
  );

  await pool.query(
    "UPDATE matches SET next_match_id=$1, next_match_slot=2 WHERE id=$2",
    [semi2.rows[0].id, m1.rows[0].id]
  );
  await pool.query(
    "UPDATE matches SET next_match_id=$1, next_match_slot=2 WHERE id=$2",
    [semi1.rows[0].id, m2.rows[0].id]
  );
  await pool.query(
    "UPDATE matches SET next_match_id=$1, next_match_slot=1 WHERE id=$2",
    [final.rows[0].id, semi1.rows[0].id]
  );
  await pool.query(
    "UPDATE matches SET next_match_id=$1, next_match_slot=2 WHERE id=$2",
    [final.rows[0].id, semi2.rows[0].id]
  );

  await pool.query(
    "UPDATE tournaments SET status='running' WHERE id=$1",
    [tournamentId]
  );

  const teamsById = new Map(teamRows.map((team) => [Number(team.id), team]));
  await notifyMatchTeams(m1.rows[0], teamsById);
  await notifyMatchTeams(m2.rows[0], teamsById);
  await notifyMatchTeams(semi1.rows[0], teamsById);
  await notifyMatchTeams(semi2.rows[0], teamsById);
  await notifyMatchTeams(final.rows[0], teamsById);

  console.log("🏆 KNOCKOUT TOURNAMENT STARTED");
}


// 🔥 CREATE ORDER
router.post("/create-order", async (req, res) => {
  try {
    const { team_id, type } = req.body;

    console.log("👉 CREATE ORDER BODY:", req.body);

    if (!team_id || !type) {
      return res.status(400).json({
        error: "team_id and type required (amateur/pro)",
      });
    }

    let amount;

    if (type === "amateur") amount = 250;
    else if (type === "pro") amount = 500;
    else {
      return res.status(400).json({
        error: "Invalid tournament type",
      });
    }

    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt: "receipt_" + Date.now(),
    });

    console.log("✅ ORDER CREATED:", order.id);

    await pool.query(
      `INSERT INTO payments (team_id, status)
       VALUES ($1, 'pending')`,
      [team_id]
    );

    res.json(order);

  } catch (err) {
    console.error("❌ CREATE ORDER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


// 🔥 VERIFY PAYMENT + AUTO TOURNAMENT SYSTEM
router.post("/verify", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      team_id,
      type,
    } = req.body;

    console.log("👉 VERIFY BODY:", req.body);

    if (!team_id || !type) {
      return res.status(400).json({
        error: "team_id and type required",
      });
    }

    // 🔐 VERIFY SIGNATURE
    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.status(400).json({
        error: "Invalid signature",
      });
    }

    console.log("✅ PAYMENT VERIFIED");

    // 🔥 UPDATE PAYMENT
    await pool.query(
      `UPDATE payments 
       SET status='success', razorpay_payment_id=$1
       WHERE team_id=$2`,
      [razorpay_payment_id, team_id]
    );

    // 🔥 FIND OR CREATE TOURNAMENT
    let tRes = await pool.query(
      `SELECT * FROM tournaments
       WHERE type=$1 AND status='waiting' AND team_count < 6
       ORDER BY id ASC LIMIT 1`,
      [type]
    );

    let tournament;

    if (!tRes.rows.length) {
      console.log("⚡ CREATING NEW TOURNAMENT");

      const entry_fee = type === "amateur" ? 250 : 500;
      const prize = type === "amateur" ? 1000 : 2000;

      const newT = await pool.query(
        `INSERT INTO tournaments (type, entry_fee, prize, team_count, status)
         VALUES ($1,$2,$3,0,'waiting')
         RETURNING *`,
        [type, entry_fee, prize]
      );

      tournament = newT.rows[0];
    } else {
      tournament = tRes.rows[0];
    }

    console.log("🎯 TOURNAMENT:", tournament.id);

    // 🔥 ASSIGN TEAM
    await pool.query(
      "UPDATE teams SET tournament_id=$1 WHERE id=$2",
      [tournament.id, team_id]
    );

    // 🔥 INCREMENT TEAM COUNT
    await pool.query(
      "UPDATE tournaments SET team_count = team_count + 1 WHERE id=$1",
      [tournament.id]
    );

    // 🔥 GET UPDATED COUNT
    const updated = await pool.query(
      "SELECT team_count FROM tournaments WHERE id=$1",
      [tournament.id]
    );

    const count = updated.rows[0].team_count;

    console.log("👥 TEAM COUNT:", count);

    // 🔥 WHEN 6 TEAMS → GENERATE KNOCKOUT MATCHES
    if (count === 6) {
      console.log("🔥 GENERATING KNOCKOUT MATCHES");
      await createKnockoutBracket(tournament.id);
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ VERIFY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
