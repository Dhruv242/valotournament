const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const QRCode = require("qrcode");
const pool = require("../db");
const { verifyJwt, requireAdmin } = require("../middleware/auth");

// Server-side source of truth for entry fees so a malicious client can't
// reduce the amount they pay.
const ENTRY_FEES = { amateur: 250, pro: 500 };

// VPA / UPI ID money is collected to. Set this in val-backend-secrets.
// Falls back to an obvious placeholder so a misconfigured deploy fails loudly.
const RECEIVER_VPA = String(process.env.UPI_VPA || "").trim();
const RECEIVER_NAME = String(process.env.UPI_NAME || "VALO Champions").trim();
const QR_VALID_MINUTES = Number(process.env.UPI_QR_VALID_MINUTES || 15);

// When AUTO_VERIFY_PAYMENTS=true, /submit-utr immediately runs the
// verification + tournament-slotting logic. Admin still has a `revoke`
// endpoint to undo a bogus payment after end-of-day bank reconciliation.
const AUTO_VERIFY = String(process.env.AUTO_VERIFY_PAYMENTS || "false")
  .toLowerCase() === "true";

if (!RECEIVER_VPA && process.env.NODE_ENV === "production") {
  console.warn("[warn] UPI_VPA not set — /payments/create-order will fail.");
}

async function ensurePaymentColumns() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      team_id INTEGER,
      order_id TEXT,
      amount INTEGER,
      currency TEXT DEFAULT 'INR',
      status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
  // New columns for the UPI / UTR flow.
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS tr TEXT");
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS vpa TEXT");
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS tournament_type TEXT");
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ");
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS submitted_utr TEXT");
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS screenshot_data_url TEXT");
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS verified_by TEXT");
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS rejection_reason TEXT");
  // A UTR can only ever verify ONE order. Hard-enforce that at the DB.
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS payments_utr_uidx ON payments (submitted_utr) WHERE submitted_utr IS NOT NULL"
  );
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS payments_tr_uidx ON payments (tr) WHERE tr IS NOT NULL"
  );
}

async function requireTeamOwnership(req, res, next) {
  try {
    if (req.user && req.user.role === "admin") return next();
    const teamId = req.body.team_id || req.body.teamId;
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
    console.error("Payment ownership check error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// Build the UPI deep-link URI for the QR. The user's UPI app uses `am`
// (amount) and `tr` (transaction reference) to pre-fill the payment. After
// they pay, the same `tr` shows up in their bank's note column so the user
// can identify which order the UTR belongs to.
function buildUpiUri({ vpa, name, amount, tr, note }) {
  const params = new URLSearchParams({
    pa: vpa,
    pn: name,
    am: String(amount),
    cu: "INR",
    tr: tr,
    tn: note || tr,
  });
  return "upi://pay?" + params.toString();
}

// ---------------------------------------------------------------------------
// POST /payments/create-order
// Body: { team_id, tournament_type }
// Returns: { order_id, tr, amount, vpa, qr_uri, valid_until }
// ---------------------------------------------------------------------------
router.post("/create-order", verifyJwt, requireTeamOwnership, async (req, res) => {
  try {
    const { team_id, tournament_type } = req.body;
    if (!team_id || !tournament_type) {
      return res.status(400).json({ error: "team_id and tournament_type required" });
    }
    const normalizedType = String(tournament_type).toLowerCase();
    const amount = ENTRY_FEES[normalizedType];
    if (!amount) return res.status(400).json({ error: "Invalid tournament_type" });

    if (!RECEIVER_VPA) {
      return res.status(500).json({ error: "UPI VPA not configured on the server." });
    }

    await ensurePaymentColumns();

    // Cancel any earlier pending orders for the same team — only one open
    // QR at a time, otherwise the admin queue fills with abandoned drafts.
    await pool.query(
      `UPDATE payments
         SET status = 'expired'
       WHERE team_id = $1
         AND status IN ('pending', 'submitted')
         AND (valid_until IS NULL OR valid_until < NOW())`,
      [team_id]
    );

    const tr = "VL" + crypto.randomBytes(6).toString("hex").toUpperCase();
    const orderId = "ord_" + crypto.randomBytes(8).toString("hex");
    const validUntil = new Date(Date.now() + QR_VALID_MINUTES * 60 * 1000);
    const note = "Team " + team_id + " " + normalizedType + " " + tr;

    await pool.query(
      `INSERT INTO payments
         (team_id, order_id, tr, amount, currency, status, tournament_type, vpa, valid_until)
       VALUES ($1, $2, $3, $4, 'INR', 'pending', $5, $6, $7)`,
      [team_id, orderId, tr, amount, normalizedType, RECEIVER_VPA, validUntil]
    );

    const qrUri = buildUpiUri({
      vpa: RECEIVER_VPA,
      name: RECEIVER_NAME,
      amount: amount,
      tr: tr,
      note: note,
    });

    // Generate the QR as a PNG data URL right here on the server.
    // Eliminates the CDN/CSP fragility of doing it in the browser.
    const qrDataUrl = await QRCode.toDataURL(qrUri, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
      color: { dark: "#0a0204", light: "#ffffff" },
    });

    res.json({
      order_id: orderId,
      tr: tr,
      amount: amount,
      vpa: RECEIVER_VPA,
      receiver_name: RECEIVER_NAME,
      qr_uri: qrUri,
      qr_data_url: qrDataUrl,
      valid_until: validUntil.toISOString(),
      valid_minutes: QR_VALID_MINUTES,
    });
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /payments/submit-utr
// Body: { order_id, utr, screenshot_data_url? }
// Marks an order as submitted; an admin must verify it before the team is
// added to a tournament.
// ---------------------------------------------------------------------------
router.post("/submit-utr", verifyJwt, async (req, res) => {
  try {
    const orderId = String(req.body.order_id || "").trim();
    const utrRaw = String(req.body.utr || "").trim().replace(/\s+/g, "");
    const screenshot = req.body.screenshot_data_url ? String(req.body.screenshot_data_url) : null;

    if (!orderId) return res.status(400).json({ error: "order_id required" });
    // UPI UTRs are 12-digit numeric. Some banks return alphanumeric refs;
    // accept 10-22 chars, alphanumeric, to be lenient without being silly.
    if (!/^[A-Za-z0-9]{10,22}$/.test(utrRaw)) {
      return res.status(400).json({ error: "UTR must be 10-22 alphanumeric characters." });
    }
    if (screenshot && screenshot.length > 600_000) {
      // ~440 KB after base64 decode. Plenty for a phone screenshot.
      return res.status(413).json({ error: "Screenshot too large (max ~440 KB)." });
    }
    if (screenshot && !/^data:image\/(png|jpe?g|webp);base64,/.test(screenshot)) {
      return res.status(400).json({ error: "Screenshot must be a PNG/JPEG/WebP data URL." });
    }

    await ensurePaymentColumns();

    // Pull the order and authorize.
    const orderRow = await pool.query(
      `SELECT p.*, t.owner_email
         FROM payments p
         LEFT JOIN teams t ON t.id = p.team_id
        WHERE p.order_id = $1`,
      [orderId]
    );
    if (!orderRow.rows.length) return res.status(404).json({ error: "Order not found" });
    const order = orderRow.rows[0];

    if (req.user.role !== "admin") {
      const tokenName = String(req.user.username || "").toLowerCase();
      const ownerName = String(order.owner_email || "").toLowerCase();
      if (!tokenName || tokenName !== ownerName) {
        return res.status(403).json({ error: "Not your order" });
      }
    }

    if (order.status === "verified") {
      return res.status(409).json({ error: "Order already verified" });
    }
    if (order.status === "rejected") {
      return res.status(409).json({ error: "Order was rejected — start a new one" });
    }
    if (order.valid_until && new Date(order.valid_until).getTime() < Date.now()) {
      await pool.query("UPDATE payments SET status='expired' WHERE id=$1", [order.id]);
      return res.status(410).json({ error: "Payment window expired — start a new order" });
    }

    try {
      await pool.query(
        `UPDATE payments
            SET submitted_utr = $1,
                screenshot_data_url = $2,
                submitted_at = NOW(),
                status = 'submitted'
          WHERE id = $3`,
        [utrRaw, screenshot, order.id]
      );
    } catch (err) {
      if (err.code === "23505") {
        // Unique violation on submitted_utr — that UTR was already used.
        return res.status(409).json({ error: "That UTR has already been submitted." });
      }
      throw err;
    }

    // Trust-then-verify mode: slot the team into a tournament immediately
    // and let the admin retroactively revoke if the UTR doesn't match.
    // At hobby scale this is dramatically less hectic than per-payment review.
    if (AUTO_VERIFY) {
      await pool.query(
        `UPDATE payments
            SET status = 'verified',
                verified_at = NOW(),
                completed_at = NOW(),
                verified_by = 'auto'
          WHERE id = $1`,
        [order.id]
      );
      try {
        const slot = await assignTeamToTournament(order.team_id, order.tournament_type);
        return res.json({
          success: true,
          status: "verified",
          message: "Payment auto-verified. Team slotted into tournament.",
          tournament_id: slot.tournament_id,
          position: slot.position,
        });
      } catch (slotErr) {
        // Slotting failed (e.g. tournament logic error). Roll status back to
        // 'submitted' so the admin can investigate manually rather than
        // silently leaving the payment as auto-verified but un-slotted.
        await pool.query(
          "UPDATE payments SET status='submitted', verified_at=NULL, verified_by=NULL WHERE id=$1",
          [order.id]
        );
        console.error("Auto-slot failed:", slotErr);
        return res.status(500).json({ error: "Slotting failed — admin will verify manually." });
      }
    }

    res.json({ success: true, message: "Payment submitted for verification.", status: "submitted" });
  } catch (err) {
    console.error("Submit UTR error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /payments/status/:order_id — players poll this to see if admin has
// verified their payment. Returns minimal info; never leaks UTR for other
// users.
// ---------------------------------------------------------------------------
router.get("/status/:order_id", verifyJwt, async (req, res) => {
  try {
    await ensurePaymentColumns();
    const result = await pool.query(
      `SELECT p.id, p.team_id, p.order_id, p.amount, p.status,
              p.tournament_type, p.valid_until, p.verified_at,
              p.rejection_reason, t.owner_email
         FROM payments p
         LEFT JOIN teams t ON t.id = p.team_id
        WHERE p.order_id = $1`,
      [req.params.order_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Order not found" });
    const order = result.rows[0];
    if (req.user.role !== "admin") {
      const tokenName = String(req.user.username || "").toLowerCase();
      const ownerName = String(order.owner_email || "").toLowerCase();
      if (!tokenName || tokenName !== ownerName) {
        return res.status(403).json({ error: "Not your order" });
      }
    }
    delete order.owner_email;
    res.json(order);
  } catch (err) {
    console.error("Status error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Shared helper — when an admin verifies a payment, the team gets slotted
// into a waiting tournament of the right type, and matches are generated if
// the tournament fills up. Pulled out of the old verify-payment route.
// ---------------------------------------------------------------------------
async function assignTeamToTournament(team_id, tournament_type) {
  let tournament = await pool.query(
    `SELECT * FROM tournaments
       WHERE tournament_type=$1 AND status='waiting' AND current_teams < max_teams
       ORDER BY created_at ASC LIMIT 1`,
    [tournament_type]
  );

  if (tournament.rows.length === 0) {
    const prizePool = tournament_type === "amateur" ? 1000 : 2000;
    const entryFee = tournament_type === "amateur" ? 250 : 500;
    tournament = await pool.query(
      `INSERT INTO tournaments (tournament_type, status, max_teams, current_teams, prize_pool, entry_fee)
       VALUES ($1, 'waiting', 8, 0, $2, $3)
       RETURNING *`,
      [tournament_type, prizePool, entryFee]
    );
  }

  const tournamentId = tournament.rows[0].id;
  const currentTeams = tournament.rows[0].current_teams;
  const position = currentTeams + 1;

  await pool.query(
    `UPDATE teams SET tournament_id=$1, tournament_position=$2 WHERE id=$3`,
    [tournamentId, position, team_id]
  );
  await pool.query(
    `UPDATE tournaments SET current_teams=current_teams+1 WHERE id=$1`,
    [tournamentId]
  );

  const updated = await pool.query(`SELECT * FROM tournaments WHERE id=$1`, [tournamentId]);

  if (updated.rows[0].current_teams === 8) {
    await pool.query(
      `UPDATE tournaments SET status='running', started_at=NOW() WHERE id=$1`,
      [tournamentId]
    );

    const teams = await pool.query(
      `SELECT id FROM teams WHERE tournament_id=$1 ORDER BY tournament_position ASC`,
      [tournamentId]
    );
    const teamIds = teams.rows.map((t) => t.id);
    const qfPairs = [
      [teamIds[0], teamIds[7]],
      [teamIds[1], teamIds[6]],
      [teamIds[2], teamIds[5]],
      [teamIds[3], teamIds[4]],
    ];

    const baseTime = new Date();
    baseTime.setHours(baseTime.getHours() + 2);

    for (let i = 0; i < qfPairs.length; i++) {
      const matchTime = new Date(baseTime.getTime() + i * 90 * 60 * 1000);
      await pool.query(
        `INSERT INTO matches
           (tournament_id, team1_id, team2_id, status, match_status, is_scheduled, scheduled_time, round, position)
         VALUES ($1, $2, $3, 'pending', 'scheduled', true, $4, 1, $5)`,
        [tournamentId, qfPairs[i][0], qfPairs[i][1], matchTime, i + 1]
      );
    }
    for (let i = 0; i < 2; i++) {
      const matchTime = new Date(baseTime.getTime() + (4 + i) * 90 * 60 * 1000);
      await pool.query(
        `INSERT INTO matches
           (tournament_id, status, match_status, is_scheduled, scheduled_time, round, position)
         VALUES ($1, 'pending', 'scheduled', true, $2, 2, $3)`,
        [tournamentId, matchTime, i + 1]
      );
    }
    const finalTime = new Date(baseTime.getTime() + 6 * 90 * 60 * 1000);
    await pool.query(
      `INSERT INTO matches
         (tournament_id, status, match_status, is_scheduled, scheduled_time, round, position)
       VALUES ($1, 'pending', 'scheduled', true, $2, 3, 1)`,
      [tournamentId, finalTime]
    );
  }

  return { tournament_id: tournamentId, position };
}

// ---------------------------------------------------------------------------
// POST /admin/payments/verify
// Body: { order_id }
// Admin-only. Marks the payment verified and slots the team into a tournament.
// ---------------------------------------------------------------------------
router.post("/admin/verify", requireAdmin, async (req, res) => {
  try {
    const orderId = String(req.body.order_id || "").trim();
    if (!orderId) return res.status(400).json({ error: "order_id required" });
    await ensurePaymentColumns();

    const orderRow = await pool.query(
      "SELECT * FROM payments WHERE order_id = $1",
      [orderId]
    );
    if (!orderRow.rows.length) return res.status(404).json({ error: "Order not found" });
    const order = orderRow.rows[0];
    if (order.status === "verified") {
      return res.status(409).json({ error: "Already verified" });
    }
    if (!order.submitted_utr) {
      return res.status(400).json({ error: "No UTR submitted yet" });
    }

    await pool.query(
      `UPDATE payments
          SET status='verified',
              verified_at = NOW(),
              completed_at = NOW(),
              verified_by = $1
        WHERE id = $2`,
      [req.user.username || "admin", order.id]
    );

    const slot = await assignTeamToTournament(order.team_id, order.tournament_type);
    res.json({
      success: true,
      message: "Payment verified, team slotted into tournament.",
      tournament_id: slot.tournament_id,
      position: slot.position,
    });
  } catch (err) {
    console.error("Admin verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/payments/reject
// Body: { order_id, reason? }
// ---------------------------------------------------------------------------
router.post("/admin/reject", requireAdmin, async (req, res) => {
  try {
    const orderId = String(req.body.order_id || "").trim();
    const reason = String(req.body.reason || "").trim().slice(0, 200);
    if (!orderId) return res.status(400).json({ error: "order_id required" });
    await ensurePaymentColumns();

    const result = await pool.query(
      `UPDATE payments
          SET status='rejected',
              rejection_reason = $1,
              verified_by = $2
        WHERE order_id = $3
        RETURNING *`,
      [reason || null, req.user.username || "admin", orderId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Order not found" });
    res.json({ success: true, message: "Payment rejected." });
  } catch (err) {
    console.error("Admin reject error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/payments/revoke
// Body: { order_id, reason? }
// Undo an already-verified payment (e.g., bank reconciliation showed the
// UTR doesn't match anything). Pulls the team out of a waiting tournament
// and decrements the team count. If the tournament has already started,
// the team stays in the bracket — admin has to handle manually because
// auto-unwinding live matches is dangerous.
// ---------------------------------------------------------------------------
router.post("/admin/revoke", requireAdmin, async (req, res) => {
  const orderId = String(req.body.order_id || "").trim();
  const reason = String(req.body.reason || "").trim().slice(0, 200);
  if (!orderId) return res.status(400).json({ error: "order_id required" });

  try {
    await ensurePaymentColumns();
    const row = await pool.query("SELECT * FROM payments WHERE order_id=$1", [orderId]);
    if (!row.rows.length) return res.status(404).json({ error: "Order not found" });
    const order = row.rows[0];
    if (order.status !== "verified") {
      return res.status(409).json({
        error: "Only verified payments can be revoked. Use /admin/reject for pending ones.",
      });
    }

    // Look at the team's tournament state before we touch anything.
    const teamRow = await pool.query(
      "SELECT id, tournament_id, tournament_position FROM teams WHERE id=$1",
      [order.team_id]
    );
    const team = teamRow.rows[0];
    let unwound = false;
    let tournamentLocked = false;

    if (team && team.tournament_id) {
      const tournRow = await pool.query(
        "SELECT id, status FROM tournaments WHERE id=$1",
        [team.tournament_id]
      );
      const tournStatus = tournRow.rows.length ? tournRow.rows[0].status : null;
      if (tournStatus === "waiting") {
        // Safe to unwind: pull the team out and decrement the counter.
        await pool.query(
          "UPDATE teams SET tournament_id=NULL, tournament_position=NULL WHERE id=$1",
          [team.id]
        );
        await pool.query(
          "UPDATE tournaments SET current_teams = GREATEST(current_teams - 1, 0) WHERE id=$1",
          [team.tournament_id]
        );
        unwound = true;
      } else {
        // Tournament already running/completed — leave bracket intact.
        tournamentLocked = true;
      }
    }

    await pool.query(
      `UPDATE payments
          SET status='revoked',
              rejection_reason=$1,
              verified_by=$2
        WHERE id=$3`,
      [reason || "revoked by admin after reconciliation", req.user.username || "admin", order.id]
    );

    res.json({
      success: true,
      message: tournamentLocked
        ? "Payment marked revoked. Tournament has already started — team was NOT removed from the bracket; handle manually."
        : "Payment revoked. Team removed from the tournament queue.",
      unwound: unwound,
      tournament_locked: tournamentLocked,
    });
  } catch (err) {
    console.error("Admin revoke error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
