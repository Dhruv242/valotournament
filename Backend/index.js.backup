const express = require("express");
const cors = require("cors");

const app = express();
const matchRoutes = require("./routes/matches");
app.use("/matches", matchRoutes);

app.use(cors());
app.use(express.json());

// 🔗 ROUTES
const teamRoutes = require("./routes/team");
const playerRoutes = require("./routes/player");
const tournamentRoutes = require("./routes/tournament");
const paymentRoutes = require("./routes/payment");
const authRoutes = require("./routes/auth");

// ✅ Health
app.get("/health", (req, res) => res.send("OK"));

// ✅ Ready (DB check)
app.get("/ready", async (req, res) => {
  try {
    const pool = require("./db");
    await pool.query("SELECT 1");
    res.send("READY");
  } catch {
    res.status(500).send("NOT READY");
  }
});

// 🏠 Root
app.get("/", (req, res) => {
  res.send("Valorant Tournament API Running");
});

// 🔥 API ROUTES
app.use("/teams", teamRoutes);
app.use("/players", playerRoutes);
app.use("/tournaments", tournamentRoutes);
app.use("/payments", paymentRoutes);
app.use("/auth", authRoutes);

// ❗ Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));