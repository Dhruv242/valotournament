const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const SECRET = process.env.JWT_SECRET;
if (!SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET required in production");
}
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || "").trim().toLowerCase();
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;
// Indian mobile: 10 digits, leading 6-9 (Airtel/Vi/Jio/BSNL range).
const PHONE_PATTERN = /^[6-9]\d{9}$/;

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      password_hash TEXT,
      password_salt TEXT,
      role TEXT NOT NULL DEFAULT 'player',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Migrations for older schemas where email was NOT NULL UNIQUE.
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_salt TEXT");
  await pool.query("ALTER TABLE users ALTER COLUMN email DROP NOT NULL").catch(() => {});
  // The old schema declared `email TEXT NOT NULL UNIQUE`, which Postgres backs
  // with a UNIQUE *constraint* named users_email_key (not a plain index).
  // `DROP INDEX` won't touch the constraint, so use DROP CONSTRAINT here.
  await pool.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key");
  // Belt and suspenders — if someone manually created a plain index with that
  // name on a different deploy, drop that too.
  await pool.query("DROP INDEX IF EXISTS users_email_key");
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uidx ON users (lower(username))"
  );
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uidx ON users (phone) WHERE phone IS NOT NULL"
  );
}

// Accepts "9876543210", "+91 98765 43210", "09876543210", "91-9876543210", etc.
// Returns the 10-digit canonical form, or "" if it can't be normalized.
function normalizePhone(input) {
  let p = String(input || "").trim().replace(/[^\d+]/g, "");
  if (p.startsWith("+91")) p = p.slice(3);
  else if (p.startsWith("91") && p.length === 12) p = p.slice(2);
  else if (p.startsWith("0") && p.length === 11) p = p.slice(1);
  return p;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET || "dev-only-do-not-use",
    { expiresIn: "1h", issuer: "valrift", audience: "valrift-frontend" }
  );
}

// Phone is intentionally NOT returned to the browser — only admins see it.
function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role };
}

// ---------------------------------------------------------------------------
// POST /auth/register — create a new account.
// Body: { username, phone, password, role? }
// ---------------------------------------------------------------------------
router.post("/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const phone = normalizePhone(req.body.phone);
  const password = String(req.body.password || "");
  const requestedRole = req.body.role === "admin" ? "admin" : "player";

  if (!USERNAME_PATTERN.test(username)) {
    return res.status(400).json({
      error: "Username must be 3-24 characters: letters, numbers, or underscores.",
    });
  }
  if (!PHONE_PATTERN.test(phone)) {
    return res.status(400).json({
      error: "Enter a valid 10-digit Indian mobile number (starts with 6-9).",
    });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  if (requestedRole === "admin" && username.toLowerCase() !== ADMIN_USERNAME) {
    return res.status(403).json({
      error: "Only the configured admin username can register as admin.",
    });
  }

  try {
    await ensureUsersTable();

    const dupe = await pool.query(
      "SELECT username, phone FROM users WHERE lower(username) = lower($1) OR phone = $2",
      [username, phone]
    );
    if (dupe.rows.length) {
      const row = dupe.rows[0];
      const conflict =
        row.username && row.username.toLowerCase() === username.toLowerCase()
          ? "username"
          : "phone number";
      return res.status(409).json({ error: "An account with that " + conflict + " already exists." });
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const result = await pool.query(
      `INSERT INTO users (username, phone, password_hash, password_salt, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, phone, role`,
      [username, phone, passwordHash, salt, requestedRole]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Username or phone already registered." });
    }
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed." });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/login — authenticate an existing account.
// Body: { username, password, role? }
// ---------------------------------------------------------------------------
router.post("/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const requestedRole = req.body.role === "admin" ? "admin" : "player";

  if (!USERNAME_PATTERN.test(username)) {
    return res.status(400).json({ error: "Enter a valid username." });
  }
  if (!password) {
    return res.status(400).json({ error: "Password is required." });
  }

  try {
    await ensureUsersTable();
    const result = await pool.query(
      "SELECT * FROM users WHERE lower(username) = lower($1)",
      [username]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    const saved = result.rows[0];
    if (!saved.password_hash || !saved.password_salt) {
      return res.status(401).json({ error: "Account has no password set. Register first." });
    }
    const passwordHash = hashPassword(password, saved.password_salt);
    if (passwordHash !== saved.password_hash) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    if (requestedRole === "admin" && saved.role !== "admin") {
      return res.status(403).json({ error: "This account is not an admin." });
    }
    res.json({ token: signToken(saved), user: publicUser(saved) });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed." });
  }
});

module.exports = router;
