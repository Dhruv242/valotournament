const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const SECRET = process.env.JWT_SECRET || "supersecret";
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || "").trim().toLowerCase();
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      password_salt TEXT,
      role TEXT NOT NULL DEFAULT 'player',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_salt TEXT");
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uidx ON users (lower(username))"
  );
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}

router.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const requestedRole = req.body.role === "admin" ? "admin" : "player";

  if (!username) {
    return res.status(400).json({ error: "Username required" });
  }

  if (!USERNAME_PATTERN.test(username)) {
    return res.status(400).json({
      error: "Username must be 3-24 characters and only use letters, numbers, or underscores",
    });
  }

  if (!email || !email.endsWith("@gmail.com")) {
    return res.status(400).json({ error: "A valid Gmail address is required" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  if (requestedRole === "admin" && username.toLowerCase() !== ADMIN_USERNAME) {
    return res.status(403).json({ error: "Only the configured admin username can use admin access" });
  }

  try {
    await ensureUsersTable();

    // Check if username exists with different email
    const existingUsername = await pool.query(
      "SELECT id, email FROM users WHERE lower(username) = lower($1) AND email <> $2",
      [username, email]
    );

    if (existingUsername.rows.length) {
      return res.status(409).json({ error: "Username already taken by another account" });
    }

    // Check if user exists by email
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    let user;

    if (existingUser.rows.length) {
      // USER EXISTS - VALIDATE PASSWORD
      const saved = existingUser.rows[0];

      // If no password set yet, this is their first login - set it now
      if (!saved.password_hash || !saved.password_salt) {
        const salt = crypto.randomBytes(16).toString("hex");
        const passwordHash = hashPassword(password, salt);
        
        const updated = await pool.query(
          `UPDATE users
           SET password_hash=$1, password_salt=$2, updated_at=NOW()
           WHERE email=$3
           RETURNING id, email, username, role`,
          [passwordHash, salt, email]
        );
        user = updated.rows[0];
        
      } else {
        // PASSWORD ALREADY SET - MUST VALIDATE
        const passwordHash = hashPassword(password, saved.password_salt);
        
        if (passwordHash !== saved.password_hash) {
          return res.status(401).json({ error: "Invalid password" });
        }

        // USERNAME CANNOT BE CHANGED AFTER REGISTRATION
        if (saved.username.toLowerCase() !== username.toLowerCase()) {
          return res.status(400).json({ 
            error: `Username locked to "${saved.username}". Cannot change username after registration.`
          });
        }

        // ROLE CANNOT BE CHANGED UNLESS ADMIN
        if (saved.role !== requestedRole && requestedRole === "admin") {
          return res.status(403).json({ 
            error: "Cannot upgrade to admin role. Contact system administrator."
          });
        }

        user = {
          id: saved.id,
          email: saved.email,
          username: saved.username,
          role: saved.role
        };
      }
      
    } else {
      // NEW USER - CREATE ACCOUNT
      const salt = crypto.randomBytes(16).toString("hex");
      const passwordHash = hashPassword(password, salt);
      
      const result = await pool.query(
        `INSERT INTO users (email, username, password_hash, password_salt, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, username, role`,
        [email, username, passwordHash, salt, requestedRole]
      );
      user = result.rows[0];
    }

    const token = jwt.sign(user, SECRET, {
      expiresIn: "1h",
    });

    res.json({ token, user });
    
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Username or Gmail already registered" });
    }

    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

module.exports = router;