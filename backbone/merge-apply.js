/* HG backbone — STEP 2: apply approved merges -> canonical rows + map + SQL.
 * Inputs : backbone/merge-state.json (from merge-propose.js)
 *          backbone/merge-review.csv with DECISION column filled (Y = merge)  [or --simulate 0.88]
 * Outputs: backbone/apply-backbone.sql  (idempotent INSERT IGNOREs — phpMyAdmin-ready)
 *          with --apply: also executes against the local scratch DB.
 * Re-runnable: fixed UUIDs come from merge-state.json; INSERT IGNORE everywhere.
 *
 * Usage:  node backbone/merge-apply.js --review backbone/merge-review.csv --apply
 *         node backbone/merge-apply.js --simulate 0.88 --apply        (local testing only)
 */
const path = require("path");
const fs = require("fs");
const mysql = require(path.join(__dirname, "..", "server", "node_modules", "mysql2", "promise"));

const ARG = k => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : null; };
const HAS = k => process.argv.includes("--" + k);
const CFG = { host: ARG("host") || "127.0.0.1", port: Number(ARG("port") || 33061),
  user: ARG("user") || "root", password: ARG("password") || undefined,
  database: ARG("db") || "hghub", dateStrings: true, multipleStatements: true };

const state = JSON.parse(fs.readFileSync(path.join(__dirname, "merge-state.json"), "utf8"));

/* ---------- collect approved fuzzy merges ---------- */
function approvedMerges() {
  const sim = ARG("simulate");
  const approved = []; // {entity, keepUuid, candUuid}
  if (sim !== null) {
    const th = Number(sim);
    for (const [entity, e] of Object.entries(state.entities))
      for (const p of e.proposals) if (p.score >= th) approved.push({ entity, keep: p.keep, cand: p.cand });
    console.log(`SIMULATE mode: auto-approving ${approved.length} proposals with score >= ${th}`);
    return approved;
  }
  const reviewPath = ARG("review") || path.join(__dirname, "merge-review.csv");
  const txt = fs.readFileSync(reviewPath, "utf8").replace(/^﻿/, "");
  const lines = txt.split(/\r?\n/).filter(Boolean);
  // parse simple quoted CSV
  const parse = l => { const out = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) { const c = l[i];
      if (q) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else { if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; } }
    out.push(cur); return out; };
  const rows = lines.slice(1).map(parse);
  // match decisions back to proposals by (entity, keepName, candName)
  for (const r of rows) {
    const [entity, keepName, candName, , , decision] = r;
    if (String(decision || "").trim().toUpperCase() !== "Y") continue;
    const e = state.entities[entity]; if (!e) continue;
    const byName = n => e.groups.find(g => g.name === n);
    const k = byName(keepName), c = byName(candName);
    if (k && c) approved.push({ entity, keep: k.uuid, cand: c.uuid });
  }
  console.log(`review file: ${approved.length} merges approved (Y)`);
  return approved;
}

/* ---------- union-find so chained merges resolve to one canonical ---------- */
function resolveGroups(entity, merges) {
  const e = state.entities[entity];
  const parent = {};
  const find = x => { while (parent[x] && parent[x] !== x) x = parent[x]; return x; };
  e.groups.forEach(g => parent[g.uuid] = g.uuid);
  for (const m of merges.filter(m => m.entity === entity)) {
    const rk = find(m.keep), rc = find(m.cand);
    if (rk !== rc) parent[rc] = rk;
  }
  const byUuid = Object.fromEntries(e.groups.map(g => [g.uuid, g]));
  const finals = new Map(); // rootUuid -> merged group
  for (const g of e.groups) {
    const root = find(g.uuid);
    let f = finals.get(root);
    if (!f) { f = { uuid: root, name: byUuid[root].name, fields: { ...byUuid[root].fields }, members: [] }; finals.set(root, f); }
    if (g.uuid !== root) {
      for (const [k, v] of Object.entries(g.fields))
        if (v !== null && v !== undefined && String(v).trim() !== "" && (f.fields[k] === undefined || f.fields[k] === "" || f.fields[k] === null)) f.fields[k] = v;
      // canonical display name = the richest label, not the most-used one
      // ("Amwic Group Sdn Bhd" must beat "amwic" even if "amwic" has more rows)
      if (String(g.name).trim().length > String(f.name).trim().length) f.name = g.name;
    }
    f.members.push(...g.members.map(m => ({ ...m })));
  }
  return [...finals.values()];
}

const esc = v => v === null || v === undefined ? "NULL" :
  "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\r?\n/g, " ") + "'";

(async function main() {
  const merges = approvedMerges();
  const conn = await mysql.createConnection(CFG);

  // mall -> state enrichment (majority vote from ja_mall_states)
  const [msRows] = await conn.query("SELECT mall, state FROM ja_mall_states");
  const mallState = {};
  for (const r of msRows) {
    const key = String(r.mall || "").toLowerCase().replace(/[.,'"()\/\\\-_&]+/g, " ").replace(/\s+/g, " ").trim();
    (mallState[key] = mallState[key] || []).push(r.state);
  }
  const majority = arr => { const c = {}; arr.forEach(s => c[s] = (c[s] || 0) + 1);
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; };

  const sql = ["-- HG backbone — canonical masters + source map (generated " + new Date().toISOString().slice(0, 10) + ")",
    "-- Idempotent: safe to run more than once.", "SET NAMES utf8mb4;"];
  const counts = {};

  for (const entity of Object.keys(state.entities)) {
    const finals = resolveGroups(entity, merges);
    counts[entity] = { canonical: finals.length, mapped: finals.reduce((t, f) => t + f.members.length, 0) };
    for (const f of finals) {
      const F = f.fields, m0 = f.members[0];
      if (entity === "client") {
        sql.push(`INSERT IGNORE INTO hg_clients (id,name,name_norm,type,contact_person,phone,email,address,reg_no,b2b_exempt,notes,status,created_by) VALUES (${esc(f.uuid)},${esc(f.name)},${esc(normKey(entity, f.name))},${esc(F.type || "Contractor")},${esc(F.contact_person || "")},${esc(F.phone || "")},${esc(F.email || "")},${esc(F.address || "")},${esc(F.reg_no || "")},${F.b2b_exempt ? 1 : 0},${esc(F.notes || "")},'active','backbone-import');`);
      } else if (entity === "worker") {
        sql.push(`INSERT IGNORE INTO hg_workers (id,full_name,name_norm,ic_number,passport_number,nationality,division,position,phone,photo_url,worker_status,team,rate,monthly_pay,bank_name,account_name,account_no,status,created_by) VALUES (${esc(f.uuid)},${esc(f.name)},${esc(normKey(entity, f.name))},${esc(F.ic_number || "")},${esc(F.passport_number || "")},${esc(F.nationality || "")},${esc(F.division || "")},${esc(F.position || "")},${esc(F.phone || "")},${esc(F.photo_url || "")},${esc(F.worker_status || "Active")},${esc(F.team || "")},${F.rate != null ? esc(F.rate) : "NULL"},${F.monthly_pay != null ? esc(F.monthly_pay) : "NULL"},${esc(F.bank_name || "")},${esc(F.account_name || "")},${esc(F.account_no || "")},'active','backbone-import');`);
      } else if (entity === "vehicle") {
        sql.push(`INSERT IGNORE INTO hg_vehicles (id,plate,plate_norm,code,vtype,make,model,year,capacity,vehicle_status,notes,status,created_by) VALUES (${esc(f.uuid)},${esc(f.name)},${esc(normKey(entity, f.name))},${esc(F.code || "")},${esc(F.vtype || "")},${esc(F.make || "")},${esc(F.model || "")},${esc(String(F.year || ""))},${esc(String(F.capacity || ""))},${esc(F.vehicle_status || "Active")},${esc(F.notes || "")},'active','backbone-import');`);
      } else if (entity === "mall") {
        const st = mallState[normKey("mall", f.name)] ? majority(mallState[normKey("mall", f.name)]) : "";
        sql.push(`INSERT IGNORE INTO hg_malls (id,name,name_norm,code,state,location,notes,status,created_by) VALUES (${esc(f.uuid)},${esc(f.name)},${esc(normKey(entity, f.name))},${esc(F.code || "")},${esc(st)},${esc(F.location || "")},${esc(F.notes || "")},'active','backbone-import');`);
      }
      for (const m of f.members) {
        sql.push(`INSERT IGNORE INTO hg_master_map (entity_type,source_table,source_id,source_name,canonical_id,method) VALUES (${esc(entity)},${esc(m.table)},${esc(m.id)},${esc(m.raw)},${esc(f.uuid)},'exact');`);
      }
    }
  }

  function normKey(entity, s) {
    if (entity === "vehicle") return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    let x = String(s || "").toLowerCase();
    if (entity === "client") x = x.replace(/\b(sdn\.?\s*bhd\.?|berhad|bhd\.?|\(m\))\b/g, " ");
    return x.replace(/[.,'"()\/\\\-_&]+/g, " ").replace(/\s+/g, " ").trim();
  }

  const out = sql.join("\n") + "\n";
  fs.writeFileSync(path.join(__dirname, "apply-backbone.sql"), out);
  console.log("counts:", JSON.stringify(counts));
  console.log("wrote backbone/apply-backbone.sql (" + Math.round(out.length / 1024) + " KB)");

  if (HAS("apply")) {
    await conn.query(out);
    const [[c]] = await conn.query("SELECT (SELECT COUNT(*) FROM hg_clients) c,(SELECT COUNT(*) FROM hg_workers) w,(SELECT COUNT(*) FROM hg_vehicles) v,(SELECT COUNT(*) FROM hg_malls) m,(SELECT COUNT(*) FROM hg_master_map) map");
    console.log("applied locally:", c);
  }
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
