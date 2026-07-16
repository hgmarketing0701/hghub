// RPC registry — ports of the Supabase plpgsql functions, one JS async fn per RPC.
// POST /api/rpc/:name   body = the args object the tools already send.
// Each fn gets ({ args, user, conn }) and returns the value the tool expects.
//
// Registration pattern: rpcs/<module>.js exports { name: async fn }, merged here.
// The full RPC-PORT checklist lives in mysql/modules/*.sql tail comments.

const express = require("express");
const { pool } = require("./db");
const { requireAuth, requireAdmin } = require("./auth");

const registry = {};

// ---- shared/foundation RPCs ----------------------------------------------

// log_audit(p_action, p_details) — used 38× across tools
// NOTE: RPC fns receive `conn` with an OPEN TRANSACTION (committed/rolled back by
// the route wrapper below). Always use conn.query, never pool, inside registry fns.
registry.log_audit = async ({ args, user, conn }) => {
  await conn.query(
    "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, ?, ?)",
    [user.email, String(args.p_action || args.action || ""), String(args.p_details || args.details || "")]
  );
  return true;
};

// ---- module RPC packs (added as they are ported) --------------------------
for (const mod of ["quotation", "hoarding", "inventory", "scaffold", "storage", "transport",
                   "visual", "workers", "claims", "expenses", "dispatch", "subcon",
                   "project-pl", "mall-platform", "blog", "hub-home"]) {
  try {
    Object.assign(registry, require("./rpcs/" + mod));
  } catch (e) {
    if (e.code !== "MODULE_NOT_FOUND") throw e;
    // pack not written yet — tools calling its RPCs get a clear 501 below
  }
}

// admin-only RPCs (server-enforced regardless of what the client claims)
const ADMIN_ONLY = new Set(["ai_run_select"]);

const router = express.Router();
router.use(requireAuth);

router.post("/:name", async (req, res) => {
  const name = req.params.name;
  const fn = registry[name];
  if (!fn) return res.status(501).json({ error: { message: "RPC not implemented: " + name } });
  if (ADMIN_ONLY.has(name) && req.user.role !== "admin")
    return res.status(403).json({ error: { message: "Admin only" } });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const data = await fn({ args: req.body || {}, user: req.user, conn });
    await conn.commit();
    res.json({ data });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    res.status(400).json({ error: { message: e.message } });
  } finally {
    conn.release();
  }
});

module.exports = { router, registry };
