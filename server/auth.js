// Email+password auth: JWT in an httpOnly cookie. Replaces Supabase Auth + allowed_users.
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("./db");

const COOKIE = "hg_session";
const SECRET = process.env.JWT_SECRET;
const TTL_DAYS = Number(process.env.SESSION_DAYS || 14);

function sign(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name || "", role: user.role },
    SECRET,
    { expiresIn: TTL_DAYS + "d" }
  );
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL_DAYS * 24 * 3600 * 1000,
    path: "/"
  };
}

// ---- middleware ----------------------------------------------------------
function requireAuth(req, res, next) {
  const tok = req.cookies[COOKIE];
  if (!tok) return res.status(401).json({ error: { message: "Not signed in" } });
  try {
    req.user = jwt.verify(tok, SECRET); // { sub, email, name, role }
    next();
  } catch {
    res.clearCookie(COOKIE, { path: "/" });
    return res.status(401).json({ error: { message: "Session expired" } });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin")
    return res.status(403).json({ error: { message: "Admin only" } });
  next();
}

// ---- routes --------------------------------------------------------------
const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) return res.status(400).json({ error: { message: "Email and password required" } });
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ? AND active = 1", [email]);
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) return res.status(401).json({ error: { message: "Wrong email or password" } });
    res.cookie(COOKIE, sign(user), cookieOpts());
    res.json({ data: { user: publicUser(user) } });
  } catch (e) { res.status(500).json({ error: { message: "Login failed: " + e.message } }); }
});

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ data: { ok: true } });
});

router.get("/session", requireAuth, async (req, res) => {
  try {
    // refreshed role check — admin revocation takes effect without waiting for JWT expiry
    const [rows] = await pool.query("SELECT id, email, name, role, active FROM users WHERE id = ?", [req.user.sub]);
    const u = rows[0];
    if (!u || !u.active) {
      res.clearCookie(COOKIE, { path: "/" });
      return res.status(401).json({ error: { message: "Account disabled" } });
    }
    res.json({ data: { user: publicUser(u) } });
  } catch (e) { res.status(500).json({ error: { message: e.message } }); }
});

// -- admin user management (replaces the allowed_users Team-access UI) -----
router.get("/users", requireAuth, requireAdmin, async (req, res) => {
  const [rows] = await pool.query("SELECT id, email, name, role, active, created_at FROM users ORDER BY email");
  res.json({ data: rows });
});

router.post("/users", requireAuth, requireAdmin, async (req, res) => {
  const { email, name, role, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: { message: "email + password required" } });
  const hash = await bcrypt.hash(String(password), 10);
  await pool.query(
    "INSERT INTO users (id, email, password_hash, name, role) VALUES (UUID(), ?, ?, ?, ?)",
    [String(email).trim().toLowerCase(), hash, name || "", role === "admin" ? "admin" : "staff"]
  );
  res.json({ data: { ok: true } });
});

router.patch("/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const sets = [], vals = [];
  if (req.body.name !== undefined) { sets.push("name = ?"); vals.push(req.body.name); }
  if (req.body.role !== undefined) { sets.push("role = ?"); vals.push(req.body.role === "admin" ? "admin" : "staff"); }
  if (req.body.active !== undefined) { sets.push("active = ?"); vals.push(req.body.active ? 1 : 0); }
  if (req.body.password) { sets.push("password_hash = ?"); vals.push(await bcrypt.hash(String(req.body.password), 10)); }
  if (!sets.length) return res.status(400).json({ error: { message: "nothing to update" } });
  vals.push(req.params.id);
  await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, vals);
  res.json({ data: { ok: true } });
});

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

module.exports = { router, requireAuth, requireAdmin };
