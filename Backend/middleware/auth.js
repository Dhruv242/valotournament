const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET;
if (!SECRET && process.env.NODE_ENV === "production") {
  // This already aborts boot in index.js, but defense-in-depth here too.
  throw new Error("JWT_SECRET not set");
}

/**
 * verifyJwt — populates req.user from a Bearer token. 401 if missing/invalid.
 * The token is the one issued by /auth/login (jwt.sign(user, SECRET)).
 */
function verifyJwt(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const decoded = jwt.verify(token, SECRET || "dev-only-do-not-use");
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * requireAdmin — verifyJwt + role check. Use on /admin/* style routes.
 */
function requireAdmin(req, res, next) {
  verifyJwt(req, res, function afterVerify() {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  });
}

// Pulls the caller's claimed identity from headers. Prefers the new
// X-User-Username header but falls back to the legacy X-User-Email header
// so older clients keep working through the cutover.
function claimedIdentity(req) {
  return String(
    req.headers["x-user-username"] ||
      req.headers["x-user-email"] ||
      req.body.owner_username ||
      req.body.owner_email ||
      ""
  )
    .trim()
    .toLowerCase();
}

/**
 * requireSelfOrAdmin — token caller must match the identity header unless
 * they're admin. Prevents one user mutating another user's resources by
 * forging a header. Downstream code reads the identity from
 * `req.headers["x-user-username"]` — we overwrite it with the token's
 * verified username so a forged header is harmless.
 */
function requireSelfOrAdmin(req, res, next) {
  verifyJwt(req, res, function afterVerify() {
    if (req.user.role === "admin") return next();

    const claimed = claimedIdentity(req);
    const tokenUsername = String(req.user.username || "").trim().toLowerCase();

    if (!tokenUsername || (claimed && claimed !== tokenUsername)) {
      return res.status(403).json({ error: "Cannot act on behalf of another user" });
    }
    // Force downstream code to see the verified identity, not the header.
    req.headers["x-user-username"] = tokenUsername;
    req.headers["x-user-email"] = tokenUsername; // legacy alias
    next();
  });
}

module.exports = { verifyJwt, requireAdmin, requireSelfOrAdmin, claimedIdentity };
