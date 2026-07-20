// Canonical masters API — the "one data backbone" every tool fetches from.
//   GET  /api/masters/:type            active rows + the caller's own pending rows
//   POST /api/masters/:type            add; duplicate-check first (returns {duplicateOf} suggestion
//                                      unless body.force). staff -> status 'pending'; admin -> 'active'
//   PATCH /api/masters/:type/:id       admin edit
//   POST /api/masters/:type/:id/approve|reject       admin
//   POST /api/masters/:type/:id/merge  {intoId}      admin: mark merged + map alias
// type ∈ clients | workers | vehicles | malls

const express = require("express");
const crypto = require("crypto");
const { pool } = require("./db");
const { requireAuth, requireAdmin } = require("./auth");

const TYPES = {
  clients:  { table: "hg_clients",  nameCol: "name",      entity: "client",
              cols: ["name","type","contact_person","phone","email","address","reg_no","b2b_exempt","notes"] },
  workers:  { table: "hg_workers",  nameCol: "full_name", entity: "worker",
              cols: ["full_name","ic_number","passport_number","nationality","division","position","phone","photo_url","worker_status","team","rate","monthly_pay","bank_name","account_name","account_no","notes"],
              adminCols: ["rate","monthly_pay","bank_name","account_name","account_no"] },
  vehicles: { table: "hg_vehicles", nameCol: "plate",     entity: "vehicle",
              cols: ["plate","code","vtype","make","model","year","capacity","vehicle_status","notes"] },
  malls:    { table: "hg_malls",    nameCol: "name",      entity: "mall",
              cols: ["name","code","state","location","notes"] }
};

function normKey(type, s) {
  if (type === "vehicles") return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let x = String(s || "").toLowerCase();
  if (type === "clients") x = x.replace(/\b(sdn\.?\s*bhd\.?|berhad|bhd\.?|\(m\))\b/g, " ");
  return x.replace(/[.,'"()\/\\\-_&]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripAdminCols(rows, t, req) {
  if (!t.adminCols || req.user.role === "admin") return rows;
  for (const r of rows) for (const c of t.adminCols) delete r[c];
  return rows;
}

const router = express.Router();
router.use(requireAuth);

function T(req, res) {
  const t = TYPES[req.params.type];
  if (!t) { res.status(400).json({ error: { message: "Unknown master type" } }); return null; }
  return t;
}

// list — active + caller's own pending (so staff see what they just added)
router.get("/:type", async (req, res) => {
  const t = T(req, res); if (!t) return;
  try {
    const [rows] = await pool.query(
      `SELECT * FROM \`${t.table}\` WHERE status='active' OR (status='pending' AND created_by=?) ORDER BY \`${t.nameCol}\``,
      [req.user.email]);
    res.json({ data: stripAdminCols(rows, t, req) });
  } catch (e) { res.status(400).json({ error: { message: e.message } }); }
});

// pending queue (admins see all pending)
router.get("/:type/pending", requireAdmin, async (req, res) => {
  const t = T(req, res); if (!t) return;
  try {
    const [rows] = await pool.query(`SELECT * FROM \`${t.table}\` WHERE status='pending' ORDER BY created_at`);
    res.json({ data: rows });
  } catch (e) { res.status(400).json({ error: { message: e.message } }); }
});

// add — duplicate-suggest first unless force
router.post("/:type", async (req, res) => {
  const t = T(req, res); if (!t) return;
  try {
    const body = req.body || {};
    const nameVal = String(body[t.nameCol] || "").trim();
    if (!nameVal) return res.status(400).json({ error: { message: t.nameCol + " required" } });
    const norm = normKey(req.params.type, nameVal);
    const normCol = req.params.type === "vehicles" ? "plate_norm" : "name_norm";
    if (!body.force) {
      const [dups] = await pool.query(
        `SELECT id, \`${t.nameCol}\` AS name, status FROM \`${t.table}\` WHERE \`${normCol}\`=? AND status IN ('active','pending') LIMIT 1`, [norm]);
      if (dups.length) return res.json({ data: { duplicateOf: dups[0] } });
    }
    const id = crypto.randomUUID();
    const status = req.user.role === "admin" ? "active" : "pending";
    const cols = ["id", normCol, "status", "created_by", req.user.role === "admin" ? "approved_by" : null].filter(Boolean);
    const vals = [id, norm, status, req.user.email]; if (req.user.role === "admin") vals.push(req.user.email);
    for (const c of t.cols) if (body[c] !== undefined) {
      if (t.adminCols && t.adminCols.includes(c) && req.user.role !== "admin") continue; // staff can't set wage/bank
      cols.push(c); vals.push(body[c]);
    }
    await pool.query(`INSERT INTO \`${t.table}\` (${cols.map(c => "`" + c + "`").join(",")}) VALUES (${cols.map(() => "?").join(",")})`, vals);
    res.json({ data: { id, status } });
  } catch (e) { res.status(400).json({ error: { message: e.message } }); }
});

// admin edit
router.patch("/:type/:id", requireAdmin, async (req, res) => {
  const t = T(req, res); if (!t) return;
  try {
    const sets = [], vals = [];
    for (const c of t.cols) if (req.body[c] !== undefined) { sets.push("`" + c + "` = ?"); vals.push(req.body[c]); }
    if (req.body[t.nameCol] !== undefined) {
      const normCol = req.params.type === "vehicles" ? "plate_norm" : "name_norm";
      sets.push("`" + normCol + "` = ?"); vals.push(normKey(req.params.type, req.body[t.nameCol]));
    }
    if (!sets.length) return res.status(400).json({ error: { message: "nothing to update" } });
    vals.push(req.params.id);
    await pool.query(`UPDATE \`${t.table}\` SET ${sets.join(", ")} WHERE id = ?`, vals);
    res.json({ data: { ok: true } });
  } catch (e) { res.status(400).json({ error: { message: e.message } }); }
});

router.post("/:type/:id/approve", requireAdmin, async (req, res) => {
  const t = T(req, res); if (!t) return;
  try {
    await pool.query(`UPDATE \`${t.table}\` SET status='active', approved_by=? WHERE id=? AND status='pending'`, [req.user.email, req.params.id]);
    res.json({ data: { ok: true } });
  } catch (e) { res.status(400).json({ error: { message: e.message } }); }
});

router.post("/:type/:id/reject", requireAdmin, async (req, res) => {
  const t = T(req, res); if (!t) return;
  try {
    await pool.query(`UPDATE \`${t.table}\` SET status='rejected', approved_by=? WHERE id=? AND status='pending'`, [req.user.email, req.params.id]);
    res.json({ data: { ok: true } });
  } catch (e) { res.status(400).json({ error: { message: e.message } }); }
});

// merge :id INTO body.intoId — id's row marked merged, alias recorded in hg_master_map
router.post("/:type/:id/merge", requireAdmin, async (req, res) => {
  const t = T(req, res); if (!t) return;
  const intoId = String((req.body || {}).intoId || "");
  if (!intoId || intoId === req.params.id) return res.status(400).json({ error: { message: "intoId required" } });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[src]] = await conn.query(`SELECT * FROM \`${t.table}\` WHERE id=?`, [req.params.id]);
    const [[dst]] = await conn.query(`SELECT id FROM \`${t.table}\` WHERE id=? AND status='active'`, [intoId]);
    if (!src || !dst) throw new Error("row not found (target must be active)");
    await conn.query(`UPDATE \`${t.table}\` SET status='merged', merged_into=?, approved_by=? WHERE id=?`, [intoId, req.user.email, req.params.id]);
    await conn.query(
      "INSERT IGNORE INTO hg_master_map (entity_type,source_table,source_id,source_name,canonical_id,method) VALUES (?,?,?,?,?,'manual')",
      [t.entity, t.table, src.id, src[t.nameCol] || "", intoId]);
    // repoint any old-source mappings that referenced the merged row
    await conn.query("UPDATE hg_master_map SET canonical_id=? WHERE canonical_id=?", [intoId, req.params.id]);
    await conn.commit();
    res.json({ data: { ok: true } });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    res.status(400).json({ error: { message: e.message } });
  } finally { conn.release(); }
});

module.exports = { router };
