// Boot guard — refuse to start without critical secrets in production.
// In dev you can still set them via .env, but `npm start` won't silently fall
// back to insecure defaults.
require("dotenv").config();

const requiredEnv = ["JWT_SECRET", "DB_PASSWORD", "UPI_VPA"];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (process.env.NODE_ENV === "production" && missing.length) {
  console.error("[fatal] Missing required env vars:", missing.join(", "));
  process.exit(1);
} else if (missing.length) {
  console.warn("[warn] Missing env vars (allowed in dev):", missing.join(", "));
}

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

// Trust the first proxy hop (nginx ingress / ALB) so req.ip is the real client IP
// for rate limiting. Use 1 (not true) to avoid IP spoofing through extra hops.
app.set("trust proxy", 1);

// === Security headers =====================================================
app.use(
  helmet({
    // CSP is owned by the frontend nginx; relax here so API responses don't
    // get a noisy CSP header.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
    crossOriginEmbedderPolicy: false,
  })
);

// === CORS — only the configured frontend may call the API =================
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow same-origin server calls (no Origin header) and any allowlisted origin
      if (!origin) return callback(null, true);
      if (!allowedOrigins.length) {
        // Dev fallback — allow all when FRONTEND_ORIGIN isn't configured
        if (process.env.NODE_ENV !== "production") return callback(null, true);
        return callback(new Error("CORS: FRONTEND_ORIGIN not configured"));
      }
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS: origin " + origin + " not allowed"));
    },
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-User-Username",
      "X-User-Email", // legacy; kept for backwards compat during cutover
      "X-User-Id",
    ],
    maxAge: 86400,
  })
);

// === Body size limits =====================================================
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

// === Rate limits ==========================================================
// Per-IP brute-force protection on login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,                   // 20 attempts / 15 min / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

// Generous global limit — catches scraping/abuse without bothering normal users
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down." },
});
app.use(globalLimiter);

// === Routes ===============================================================
const teamRoutes = require("./routes/team");
const playerRoutes = require("./routes/player");
const tournamentRoutes = require("./routes/tournament");
const paymentRoutes = require("./routes/payment");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const matchRoutes = require("./routes/matches");

// ✅ Health probes — left unauthenticated so Kubernetes can check them
app.get("/health", (req, res) => res.send("OK"));
app.get("/ready", async (req, res) => {
  try {
    const pool = require("./db");
    await pool.query("SELECT 1");
    res.send("READY");
  } catch (err) {
    // Surface the actual reason so kubectl logs is useful
    console.error("[ready] DB check failed:", err && err.message ? err.message : err);
    res.status(500).send("NOT READY: " + (err && err.message ? err.message : "unknown"));
  }
});

app.get("/", (req, res) => res.send("Valorant Tournament API Running"));

// All API routes are mounted under both / (legacy / direct backend access)
// and /api (when the ingress routes /api/* to this service without stripping
// the prefix). This makes the deployment robust against rewrite-target quirks
// in different ingress controllers.
function mountAll(prefix) {
  app.use(prefix + "/auth", loginLimiter, authRoutes);
  app.use(prefix + "/teams", teamRoutes);
  app.use(prefix + "/players", playerRoutes);
  app.use(prefix + "/tournaments", tournamentRoutes);
  app.use(prefix + "/payments", paymentRoutes);
  app.use(prefix + "/admin", adminRoutes);
  app.use(prefix + "/matches", matchRoutes);
}
mountAll("");
mountAll("/api");

// ❗ Global error handler — never leak stack/internals to clients
app.use((err, req, res, next) => {
  // CORS errors land here as plain Error
  if (err && /^CORS:/.test(err.message)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  console.error("[error]", err && err.stack ? err.stack : err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
