/* HG backbone — STEP 1: propose merges across all master lists.
 * Reads the local scratch DB, groups duplicates:
 *   - exact (normalized) matches  -> auto-merged into one canonical group
 *   - fuzzy matches               -> written to merge-review.csv for Black (Y/N)
 * Outputs: backbone/merge-state.json (groups + proposals), backbone/merge-review.csv
 * Re-runnable: pure read + file outputs, no DB writes.
 *
 * Usage: node backbone/merge-propose.js  [--host 127.0.0.1 --port 33061 --user root --db hghub]
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const mysql = require(path.join(__dirname, "..", "server", "node_modules", "mysql2", "promise"));

const ARG = k => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : null; };
const CFG = {
  host: ARG("host") || "127.0.0.1", port: Number(ARG("port") || 33061),
  user: ARG("user") || "root", password: ARG("password") || undefined,
  database: ARG("db") || "hghub", dateStrings: true
};

/* ---------- normalization ---------- */
const CLIENT_SUFFIX = /\b(sdn\.?\s*bhd\.?|berhad|bhd\.?|\(m\))\b/g;
function normName(s) {
  return String(s || "").toLowerCase()
    .replace(/[.,'"()\/\\\-_&]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function normClient(s) { return normName(String(s || "").toLowerCase().replace(CLIENT_SUFFIX, " ")); }
function normPlate(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

/* ---------- fuzzy scoring ---------- */
function bigrams(s) { const out = new Set(); const t = s.replace(/\s+/g, ""); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; }
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}
function tokenSubset(a, b) {
  const A = a.split(" ").filter(Boolean), B = b.split(" ").filter(Boolean);
  if (!A.length || !B.length) return false;
  const setB = new Set(B), setA = new Set(A);
  return A.every(t => setB.has(t)) || B.every(t => setA.has(t));
}

/* ---------- source definitions (priority order = field-fill order) ---------- */
const SOURCES = {
  client: [
    { table: "clients", sql: "SELECT id, name, type, phone, email, contact_person, address, notes FROM clients", name: r => r.name },
    { table: "trn_clients", sql: "SELECT id, company, reg_no, pic, contact, email, address, notes FROM trn_clients", name: r => r.company,
      fields: r => ({ reg_no: r.reg_no, contact_person: r.pic, phone: r.contact, email: r.email, address: r.address }) },
    { table: "tc_clients", sql: "SELECT id, name, type, contact_name, contact_email, contact_tel, b2b_exempt, notes FROM tc_clients", name: r => r.name,
      fields: r => ({ type: r.type, contact_person: r.contact_name, email: r.contact_email, phone: r.contact_tel, b2b_exempt: r.b2b_exempt ? 1 : 0 }) },
    { table: "ja_lookups", sql: "SELECT id, value FROM ja_lookups WHERE type='client'", name: r => r.value, nameOnly: true }
  ],
  worker: [
    { table: "wkr_workers", sql: "SELECT w.id, w.full_name, w.ic_number, w.passport_number, w.nationality, d.name AS division, w.position, w.phone, w.photo_url, w.status FROM wkr_workers w LEFT JOIN wkr_divisions d ON d.id=w.division_id", name: r => r.full_name,
      fields: r => ({ ic_number: r.ic_number, passport_number: r.passport_number, nationality: r.nationality, division: r.division, position: r.position, phone: r.phone, photo_url: r.photo_url, worker_status: r.status }) },
    { table: "ja_workers", sql: "SELECT id, name, rate, team, monthly_pay, bank_name, account_name, account_no FROM ja_workers", name: r => r.name,
      fields: r => ({ team: r.team, rate: r.rate, monthly_pay: r.monthly_pay, bank_name: r.bank_name, account_name: r.account_name, account_no: r.account_no }) },
    { table: "pl_workers", sql: "SELECT id, name, role, contact_number FROM pl_workers", name: r => r.name,
      fields: r => ({ position: r.role, phone: r.contact_number }) },
    { table: "inv_workers", sql: "SELECT id, name, role, division FROM inv_workers", name: r => r.name,
      fields: r => ({ position: r.role, division: r.division }) }
  ],
  vehicle: [
    { table: "lry_vehicles", sql: "SELECT id, plate, vehicle_code, model, year, vehicle_type, status, active, notes FROM lry_vehicles", name: r => r.plate,
      fields: r => ({ code: r.vehicle_code, model: r.model, year: r.year, vtype: r.vehicle_type, vehicle_status: (r.status || (r.active ? "Active" : "Retired")) }) },
    { table: "flt_vehicles", sql: "SELECT id, plate, model, type, year, lorry_code, notes FROM flt_vehicles", name: r => r.plate,
      fields: r => ({ model: r.model, vtype: r.type, year: r.year, code: r.lorry_code }) },
    { table: "trn_lorries", sql: "SELECT id, plate_no, code, type, capacity, category, active FROM trn_lorries", name: r => r.plate_no,
      fields: r => ({ code: r.code, vtype: r.type, capacity: r.capacity }) },
    { table: "tc_lorries", sql: "SELECT id, plate_no, code, type, category, capacity, notes FROM tc_lorries", name: r => r.plate_no,
      fields: r => ({ code: r.code, vtype: r.type, capacity: r.capacity }) },
    { table: "ja_lorries", sql: "SELECT id, plate FROM ja_lorries", name: r => r.plate, nameOnly: true }
  ],
  mall: [
    { table: "mp_malls", sql: "SELECT id, name, code, location, notes FROM mp_malls", name: r => r.name,
      fields: r => ({ code: r.code, location: r.location }) },
    { table: "malls", sql: "SELECT id, name, code, location, notes FROM malls", name: r => r.name,
      fields: r => ({ code: r.code, location: r.location }) },
    { table: "vis_malls", sql: "SELECT id, name FROM vis_malls", name: r => r.name, nameOnly: true },
    { table: "ja_lookups", sql: "SELECT id, value FROM ja_lookups WHERE type='mall'", name: r => r.value, nameOnly: true }
  ]
};

const NORM = { client: normClient, worker: normName, vehicle: normPlate, mall: normName };
const FUZZY_MIN = { client: 0.80, worker: 0.84, vehicle: 0.90, mall: 0.72 };

(async function main() {
  const conn = await mysql.createConnection(CFG);
  const state = { generatedAt: null, entities: {} };
  const reviewRows = [["entity", "KEEP (primary entry)", "MERGE candidate", "candidate source", "similarity", "DECISION (Y/N)"]];

  for (const [entity, sources] of Object.entries(SOURCES)) {
    const norm = NORM[entity];
    const groups = new Map(); // norm -> group

    for (const src of sources) {
      const [rows] = await conn.query(src.sql);
      for (const r of rows) {
        const rawName = String(src.name(r) || "").trim();
        if (!rawName) continue;
        const key = norm(rawName);
        if (!key) continue;
        let g = groups.get(key);
        if (!g) {
          g = { uuid: crypto.randomUUID(), key, name: rawName, primarySource: src.table,
                fields: {}, members: [] };
          groups.set(key, g);
        }
        // longest/most complete display name wins for the label
        if (rawName.length > g.name.length && src.table === g.primarySource) g.name = rawName;
        // priority fill: first source (list order) to supply a field keeps it
        const f = src.fields ? src.fields(r) : {};
        for (const [k, v] of Object.entries(f)) {
          if (v !== null && v !== undefined && String(v).trim() !== "" && (g.fields[k] === undefined || g.fields[k] === "" || g.fields[k] === null)) {
            g.fields[k] = v;
          }
        }
        g.members.push({ table: src.table, id: String(r.id), raw: rawName });
      }
    }

    // fuzzy proposals between distinct groups
    const arr = [...groups.values()];
    const proposals = [];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        let score = dice(a.key, b.key);
        if (entity !== "vehicle" && tokenSubset(a.key, b.key)) score = Math.max(score, 0.9);
        if (score >= FUZZY_MIN[entity]) {
          // keep the group with more members / richer fields as primary
          const [keep, cand] = (a.members.length >= b.members.length) ? [a, b] : [b, a];
          proposals.push({ keep: keep.uuid, cand: cand.uuid, score: Math.round(score * 100) / 100 });
          reviewRows.push([entity, keep.name, cand.name, cand.members.map(m => m.table).join("+"), score.toFixed(2), ""]);
        }
      }
    }

    state.entities[entity] = { groups: arr, proposals };
    console.log(`${entity}: ${arr.reduce((t, g) => t + g.members.length, 0)} source rows -> ${arr.length} exact groups, ${proposals.length} fuzzy proposals`);
  }

  state.generatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, "merge-state.json"), JSON.stringify(state, null, 1));
  // CSV (Excel-friendly, BOM for utf8)
  const csv = "﻿" + reviewRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  fs.writeFileSync(path.join(__dirname, "merge-review.csv"), csv);
  console.log("\nwrote backbone/merge-state.json + backbone/merge-review.csv");
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
