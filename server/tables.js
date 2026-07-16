// Generic table CRUD — the backend for the hg-client.js supabase-compat shim.
//
// Filter grammar (query params, mirrors the supabase-js subset the tools use):
//   ?select=col1,col2          columns (default *)
//   ?eq.col=v  ?neq.col=v  ?gte.col=v  ?lte.col=v  ?gt.col=v  ?lt.col=v
//   ?ilike.col=%pat%           case-insensitive LIKE
//   ?in.col=a,b,c              IN list (URL-encoded values)
//   ?is.col=null               IS NULL
//   ?contains.col=v            JSON array/object containment (JSON_CONTAINS)
//   ?or=(eq.a.1,ilike.b.%x%)   OR group of simple conditions
//   ?order=col.desc,col2.asc   ORDER BY
//   ?limit=n ?offset=n
//   ?single=1 | ?maybe=1       return one row (error if 0 for single)
// Writes:
//   POST   /:table             body = row | [rows];  ?upsert=1 → ON DUPLICATE KEY UPDATE
//   PATCH  /:table?<filters>   body = patch object
//   DELETE /:table?<filters>
// Responses: { data, error } — same shape the tools already handle.

const express = require("express");
const { pool } = require("./db");
const { requireAuth, requireAdmin } = require("./auth");
const { tableRules, appendOnly } = require("./rules");

const router = express.Router();
router.use(requireAuth);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function badReq(res, message) { return res.status(400).json({ error: { message } }); }

function checkIdent(name) {
  if (!IDENT.test(name)) throw new Error("Invalid identifier: " + name);
  return name;
}

// ---- access rules --------------------------------------------------------
// rules.js exports { [table]: { read: 'staff'|'admin', write: 'staff'|'admin',
//                               hideCols?: [..cols hidden for non-admin], deny?: true } }
function gate(req, res, table, mode /* 'read'|'write' */) {
  const rule = tableRules[table] || {};
  if (rule.deny) { res.status(403).json({ error: { message: "Table not accessible" } }); return null; }
  const need = rule[mode] || "staff";
  if (need === "admin" && req.user.role !== "admin") {
    res.status(403).json({ error: { message: "Admin only" } });
    return null;
  }
  return rule;
}

function stripHidden(rows, rule, req) {
  if (!rule.hideCols || req.user.role === "admin" || !rows) return rows;
  const arr = Array.isArray(rows) ? rows : [rows];
  for (const r of arr) for (const c of rule.hideCols) if (c in r) delete r[c];
  return rows;
}

// ---- filter builder ------------------------------------------------------
const OPS = { eq: "= ?", neq: "!= ?", gt: "> ?", lt: "< ?", gte: ">= ?", lte: "<= ?" };

function buildWhere(query) {
  const where = [], vals = [];
  for (const [key, raw] of Object.entries(query)) {
    const v = String(raw);
    const dot = key.indexOf(".");
    if (dot < 0) continue;
    const op = key.slice(0, dot), col = key.slice(dot + 1);
    if (["select", "order", "limit", "offset", "single", "maybe", "upsert", "or"].includes(op)) continue;
    if (op in OPS) { checkIdent(col); where.push(`\`${col}\` ${OPS[op]}`); vals.push(v); }
    else if (op === "ilike") { checkIdent(col); where.push(`\`${col}\` LIKE ?`); vals.push(v); }
    else if (op === "in") {
      checkIdent(col);
      const items = v.split(",");
      where.push(`\`${col}\` IN (${items.map(() => "?").join(",")})`);
      vals.push(...items);
    }
    else if (op === "is") { checkIdent(col); where.push(v === "null" ? `\`${col}\` IS NULL` : `\`${col}\` IS NOT NULL`); }
    else if (op === "contains") {
      checkIdent(col);
      where.push(`JSON_CONTAINS(\`${col}\`, ?)`);
      vals.push(JSON.stringify(isNaN(Number(v)) ? v : v)); // scalar containment; arrays arrive JSON-encoded
    }
  }
  // or=(eq.col.val,ilike.col.pat)
  if (query.or) {
    const parts = String(query.or).replace(/^\(|\)$/g, "").split(",");
    const ors = [];
    for (const p of parts) {
      const [op, col, ...rest] = p.split(".");
      const val = rest.join(".");
      if (op === "eq") { checkIdent(col); ors.push(`\`${col}\` = ?`); vals.push(val); }
      else if (op === "ilike") { checkIdent(col); ors.push(`\`${col}\` LIKE ?`); vals.push(val.replace(/\*/g, "%")); }
    }
    if (ors.length) where.push("(" + ors.join(" OR ") + ")");
  }
  return { sql: where.length ? " WHERE " + where.join(" AND ") : "", vals };
}

function buildTail(query) {
  let sql = "";
  const vals = [];
  if (query.order) {
    const parts = String(query.order).split(",").map(s => {
      const [col, dir] = s.split(".");
      checkIdent(col);
      return `\`${col}\` ${dir && dir.toLowerCase() === "desc" ? "DESC" : "ASC"}`;
    });
    sql += " ORDER BY " + parts.join(", ");
  }
  if (query.limit !== undefined) { sql += " LIMIT ?"; vals.push(Number(query.limit) || 0); }
  if (query.offset !== undefined) { sql += " OFFSET ?"; vals.push(Number(query.offset) || 0); }
  return { sql, vals };
}

function selectCols(query) {
  if (!query.select || query.select === "*") return "*";
  return String(query.select).split(",").map(c => "`" + checkIdent(c.trim()) + "`").join(", ");
}

// JSON columns: mysql2 returns JSON as string on some setups — normalize
function normalizeRow(row) {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
      try { row[k] = JSON.parse(v); } catch { /* keep string */ }
    }
  }
  return row;
}

function serializeVals(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    checkIdent(k);
    out[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  }
  return out;
}

// ---- routes --------------------------------------------------------------
router.get("/:table", async (req, res) => {
  try {
    const table = checkIdent(req.params.table);
    const rule = gate(req, res, table, "read"); if (!rule) return;
    const { sql: w, vals: wv } = buildWhere(req.query);
    const { sql: t, vals: tv } = buildTail(req.query);
    const [rows] = await pool.query(`SELECT ${selectCols(req.query)} FROM \`${table}\`${w}${t}`, [...wv, ...tv]);
    rows.forEach(normalizeRow);
    stripHidden(rows, rule, req);
    if (req.query.single || req.query.maybe) {
      if (req.query.single && rows.length === 0) return res.status(406).json({ error: { message: "No rows found" } });
      return res.json({ data: rows[0] || null });
    }
    res.json({ data: rows });
  } catch (e) { res.status(400).json({ error: { message: e.message } }); }
});

router.post("/:table", async (req, res) => {
  try {
    const table = checkIdent(req.params.table);
    const rule = gate(req, res, table, "write"); if (!rule) return;
    const rows = (Array.isArray(req.body) ? req.body : [req.body]).map(serializeVals);
    if (!rows.length || !Object.keys(rows[0]).length) return badReq(res, "Empty insert");
    const cols = Object.keys(rows[0]);
    const colSql = cols.map(c => "`" + c + "`").join(", ");
    const placeholders = rows.map(() => "(" + cols.map(() => "?").join(",") + ")").join(", ");
    const vals = rows.flatMap(r => cols.map(c => r[c] === undefined ? null : r[c]));
    let sql = `INSERT INTO \`${table}\` (${colSql}) VALUES ${placeholders}`;
    if (req.query.upsert) sql += " ON DUPLICATE KEY UPDATE " + cols.map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(", ");
    const [r] = await pool.query(sql, vals);
    res.json({ data: { affectedRows: r.affectedRows, insertId: r.insertId } });
  } catch (e) { res.status(400).json({ error: { message: e.message } }); }
});

router.patch("/:table", async (req, res) => {
  try {
    const table = checkIdent(req.params.table);
    if (appendOnly.has(table)) return res.status(403).json({ error: { message: "Table is append-only" } });
    const rule = gate(req, res, table, "write"); if (!rule) return;
    const { sql: w, vals: wv } = buildWhere(req.query);
    if (!w) return badReq(res, "Refusing to UPDATE without a filter");
    const patch = serializeVals(req.body || {});
    const cols = Object.keys(patch);
    if (!cols.length) return badReq(res, "Empty update");
    const [r] = await pool.query(
      `UPDATE \`${table}\` SET ${cols.map(c => `\`${c}\` = ?`).join(", ")}${w}`,
      [...cols.map(c => patch[c]), ...wv]
    );
    res.json({ data: { affectedRows: r.affectedRows } });
  } catch (e) { res.status(400).json({ error: { message: e.message } }); }
});

router.delete("/:table", async (req, res) => {
  try {
    const table = checkIdent(req.params.table);
    if (appendOnly.has(table)) return res.status(403).json({ error: { message: "Table is append-only" } });
    const rule = gate(req, res, table, "write"); if (!rule) return;
    const { sql: w, vals: wv } = buildWhere(req.query);
    if (!w) return badReq(res, "Refusing to DELETE without a filter");
    const [r] = await pool.query(`DELETE FROM \`${table}\`${w}`, wv);
    res.json({ data: { affectedRows: r.affectedRows } });
  } catch (e) { res.status(400).json({ error: { message: e.message } }); }
});

module.exports = { router };
