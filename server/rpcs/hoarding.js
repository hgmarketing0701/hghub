// RPC pack: hoarding (hrd_) — JS port of supabase/schema-hoarding.sql functions.
// Exports ONLY the rpc()-called functions used by hoarding-supabase.html:
//   hrd_save_quote · hrd_edit_material_price · hrd_apply_supplier
// hrd_cfg / hrd_client_rate / hrd_unit_of / hrd_roundup / hrd_line are internal
// helpers below (they were plpgsql helpers, never called from the client).
//
// CALC ENGINE — verified exact port of "HG Metal Deck Calculator (3).xlsx"
// via Code.gs → plpgsql → here. Same maths (IEEE-754 doubles), same round-ups
// (roundUp(x) = Math.ceil(x - 1e-9)), final money totals rounded to 2 dp.
//
// VERIFIED TEST CASE (must reproduce to the cent — see mysql/modules/02-hoarding.sql):
//   inputs L=160, H=2.4, CC=3, doors=1, horizLines=3, footPerPost=2,
//   pInstall=8, pFab=15, gateDays=2, sqftF=11.16, gStruct=40.8, gPanel=155,
//   gPosts=2, gFoot=4, oXbrace=0, post=MS-50x75x1.5, horiz=MS-50x50x1.5,
//   panel=DECK-0.23, footing=FOOTING-450x450x750, deckGate=DECK-0.48, seed rates
//   → hoarding_total 47,860.14 · gate_total 5,740.26 · subtotal 53,600.39
//
// MySQL notes: DECIMAL columns arrive as strings from mysql2 → always Number().
// conn = mysql2 connection with an OPEN TRANSACTION (route commits/rolls back);
// use ONLY conn.query in here; throw on failure.

const crypto = require("crypto");

// ---- internal helpers (ports of the plpgsql helper functions) --------------

// n(v): coalesce(nullif(v,'')::double precision, 0) — missing/empty/non-numeric → 0
function n(v) {
  if (v === null || v === undefined || v === "") return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

// s(v): coalesce(nullif(v,''), null) — empty string treated as missing
function s(v) {
  return v === null || v === undefined || v === "" ? null : String(v);
}

// roundUp_(x) = Math.ceil(x - 1e-9) — exact GAS/Excel round-up (hrd_roundup)
function roundUp(x) {
  return Math.ceil(x - 1e-9);
}

// round to 2 dp (money) / 4 dp (dims) — cents-safe, matches pg round(numeric, n)
function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
function round4(x) {
  return Math.round((x + Number.EPSILON) * 10000) / 10000;
}

// RM money formatter for audit details — matches to_char(..,'FM999,999,999,990.00')
function fmtRM(x) {
  return round2(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// hrd_cfg(key) — hrd_config.value for a key, null if absent
async function cfg(conn, key) {
  const [rows] = await conn.query("SELECT `value` FROM hrd_config WHERE `key` = ?", [key]);
  return rows.length ? rows[0].value : null;
}

// hrd_client_rate(code) — (cost_price / bar_qty when bar_qty≠0 else cost_price)
// × (1 + markup); missing material → 0 (exact port of withRates_ in Code.gs)
async function clientRate(conn, code) {
  const [rows] = await conn.query(
    "SELECT bar_qty, cost_price, markup FROM hrd_materials WHERE code = ?", [code]);
  if (!rows.length) return 0;
  const barQty = n(rows[0].bar_qty);           // DECIMAL → string → Number
  const cost   = n(rows[0].cost_price);
  const markup = n(rows[0].markup);
  return (barQty !== 0 ? cost / barQty : cost) * (1 + markup);
}

// hrd_unit_of(code) — hrd_materials.unit, '' if missing
async function unitOf(conn, code) {
  const [rows] = await conn.query("SELECT unit FROM hrd_materials WHERE code = ?", [code]);
  return rows.length ? (rows[0].unit || "") : "";
}

// hrd_line(item, code, rate, sub, qty, unit) — one costing line, total = sub*qty
function line(item, code, rate, sub, qty, unit) {
  return { item, code, rate, sub, qty, unit, total: sub * qty };
}

// audit_log insert — mirror of the shared log_audit RPC (same table/columns)
async function logAudit(conn, email, action, details) {
  await conn.query(
    "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, ?, ?)",
    [email, action, details]);
}

// Asia/Kuala_Lumpur is fixed UTC+8 (no DST)
function klNow() {
  return new Date(Date.now() + 8 * 3600 * 1000); // read via getUTC* methods
}
function klToday() {
  const d = klNow();
  return d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(d.getUTCDate()).padStart(2, "0");
}

// ---- exported RPCs ----------------------------------------------------------

module.exports = {

  // hrd_save_quote({ payload }) → { id, quote_no }
  // AUTHORITATIVE server-side recompute (exact port of computeQuote_ + saveQuote
  // in Code.gs / hrd_save_quote in plpgsql). Rates resolve from the LIVE
  // hrd_materials catalog; the full snapshot {inputs, lines:{H,G}, metrics} is
  // frozen into hrd_quotes.data — later price edits never change a saved quote.
  hrd_save_quote: async ({ args, user, conn }) => {
    const payload = args.payload || {};
    const i = payload.inputs || {};

    // coalesce(payload->>'client','') = '' → error
    if (s(payload.client) === null) throw new Error("Client name is required.");

    // inputs (all IEEE-754 doubles, same maths as the JS/Excel engine)
    const vLength = n(i.length);
    const vHeight = n(i.height);
    let   vCc     = n(i.cc);          if (vCc === 0) vCc = 1;         // n(i.cc)||1
    const vDoors  = n(i.doors);
    const vHorizLines  = n(i.horizLines);
    const vFootPerPost = n(i.footPerPost);
    let   vPInstall = n(i.pInstall);  if (vPInstall === 0) vPInstall = 1;
    let   vPFab     = n(i.pFab);      if (vPFab === 0) vPFab = 1;
    const vGateDays = n(i.gateDays);
    const vSqftF   = n(i.sqftF);
    const vGStruct = n(i.gStruct);
    const vGPanel  = n(i.gPanel);
    const vGPosts  = n(i.gPosts);
    const vGFoot   = n(i.gFoot);
    const vOXbrace = n(i.oXbrace);
    const vLFabPost = n(i.lFabPost);
    const vLPrelim  = n(i.lPrelim);
    const vLInstall = n(i.lInstall);
    const vLFabGate = n(i.lFabGate);
    const vLInstallGate = n(i.lInstallGate);
    const vSstPct = n(i.sst);

    // xbraceLen: input > config XBRACE_LEN > 10.8
    let vXbraceLen;
    if (s(i.xbraceLen) !== null && Number.isFinite(Number(i.xbraceLen))) {
      vXbraceLen = Number(i.xbraceLen);
    } else {
      const c = s(await cfg(conn, "XBRACE_LEN"));
      vXbraceLen = c !== null && Number.isFinite(Number(c)) ? Number(c) : 10.8;
    }

    // category-driven material selection (backward compatible with old
    // cladding/fixed-code quotes — same fallback chain as Code.gs)
    const vPostCode  = String(i.postCode || "");
    const vHorizCode = String(i.horizCode || "");
    const vPanelCode = s(i.panelCode) ||
      (i.cladding === "gi"
        ? (s(i.giCode)   || await cfg(conn, "CODE_GI"))
        : (s(i.deckMain) || await cfg(conn, "CODE_DECK_MAIN")));
    const vFoundCode  = s(i.foundCode) || s(i.footCode) || await cfg(conn, "CODE_FOOTING");
    const vDeckGate   = s(i.deckGate)   || await cfg(conn, "CODE_DECK_GATE");
    const vXbraceCode = s(i.xbraceCode) || await cfg(conn, "CODE_XBRACE");

    // ═══ CALC ENGINE (do not change — exact Excel port) ═══
    const postPerPost = 2 * Math.sqrt(Math.pow(vHeight - 0.3, 2) + Math.pow(1.2, 2)) + 2.1;
    const posts       = roundUp(vLength / vCc);
    const installDays = roundUp(posts / vPInstall);
    const fabDays     = roundUp(posts / vPFab);
    const deckSqft    = roundUp(vLength * vHeight * vSqftF);
    const rPost  = await clientRate(conn, vPostCode);
    const rHoriz = await clientRate(conn, vHorizCode);
    const rPanel = await clientRate(conn, vPanelCode);
    const rFound = await clientRate(conn, vFoundCode);
    const rGatePanel = await clientRate(conn, vDeckGate);
    const rXbrace    = await clientRate(conn, vXbraceCode);
    const uPanel = await unitOf(conn, vPanelCode);
    const uFound = await unitOf(conn, vFoundCode);
    const uDeckGate = await unitOf(conn, vDeckGate);

    const H = [
      line("Vertical Post + Brace", vPostCode, rPost, postPerPost * rPost, posts, "set"),
      line("Horizontal", vHorizCode, rHoriz, rHoriz, vLength * vHorizLines, "m"),
      line("Labor Fabrication (Post)", "—", vLFabPost, vLFabPost, posts, "set"),
      line("Preliminaries", "—", vLPrelim, vLPrelim, installDays, "day"),
      line("Labor Installation (Onsite)", "—", vLInstall, vLInstall, installDays, "day"),
      line("Hoarding Panel", vPanelCode, rPanel, rPanel, deckSqft, uPanel),
      line("Base / Footing", vFoundCode, rFound, rFound, posts * vFootPerPost, uFound),
      line("ADD ON: X Brace", vXbraceCode, rXbrace, vXbraceLen * rXbrace, vOXbrace, "set"),
    ];
    const hoardTotal = H.reduce((sum, e) => sum + e.total, 0);

    const G = [
      line("Gate Post", vPostCode, rPost, postPerPost * rPost, vDoors * vGPosts, "nos"),
      line("Gate Structure", vHorizCode, rHoriz, rHoriz, vDoors * vGStruct, "m"),
      line("Gate Panel", vDeckGate, rGatePanel, rGatePanel, vDoors * vGPanel, uDeckGate),
      line("Base / Footing (Gate)", vFoundCode, rFound, rFound, vDoors * vGFoot, uFound),
      line("Labor Fabrication (Post-Gate)", "—", vLFabPost, vLFabPost, vDoors * vGPosts, "nos"),
      line("Labor Fabrication (Gate)", "—", vLFabGate, vLFabGate, vDoors, "nos"),
      line("Labor Installation (Gate Onsite)", "—", vLInstallGate, vLInstallGate, vDoors * vGateDays, "day"),
    ];
    const gateTotal = G.reduce((sum, e) => sum + e.total, 0);

    const vSub    = hoardTotal + gateTotal;
    const vSstAmt = vSub * (vSstPct / 100);
    const vGrand  = vSub + vSstAmt;
    // ═══ end calc engine ═══

    const metrics = {
      posts, postPerPost, vert: posts * postPerPost,
      horiz: vLength * vHorizLines, foot: posts * vFootPerPost,
      sqft: deckSqft, installDays, fabDays,
      projectDays: Math.max(installDays, fabDays) + vDoors * vGateDays,
    };
    const data = { inputs: i, lines: { H, G }, metrics };

    const vStatus = ["Draft", "Sent", "Won", "Lost"].includes(payload.status)
      ? payload.status : "Draft";
    const vDate = s(payload.date) || klToday();

    // existing record?
    let existing = null;
    if (s(payload.id) !== null) {
      const [rows] = await conn.query("SELECT * FROM hrd_quotes WHERE id = ?", [String(payload.id)]);
      if (!rows.length) throw new Error("Quote not found.");
      existing = rows[0];
    }

    // quote number: given > existing > next sequential PREFIX-YYYY-### (skips used)
    let quoteNo = s(payload.quoteNo);
    if (quoteNo === null && existing) quoteNo = existing.quote_no;
    if (quoteNo === null) {
      const prefix = s(await cfg(conn, "QUOTE_PREFIX")) || "HG-Q-";
      const year = String(klNow().getUTCFullYear());
      let seq = parseInt(s(await cfg(conn, "QUOTE_SEQ")) || "0", 10) || 0;
      for (;;) {
        seq += 1;
        quoteNo = prefix + year + "-" + String(seq).padStart(3, "0");
        const [dup] = await conn.query(
          "SELECT 1 FROM hrd_quotes WHERE LOWER(quote_no) = LOWER(?) LIMIT 1", [quoteNo]);
        if (!dup.length) break;
      }
    }

    let id;
    if (existing) {
      id = existing.id;
      await conn.query(
        `UPDATE hrd_quotes SET
           quote_no = ?, quote_date = ?, client = ?, contact = ?, project = ?,
           mall = ?, lot = ?, location = ?, validity = ?, status = ?,
           length = ?, height = ?, doors = ?,
           hoarding_total = ?, gate_total = ?, subtotal = ?,
           sst_pct = ?, sst_amount = ?, grand_total = ?,
           data = ?, updated_by = ?, updated_at = NOW()
         WHERE id = ?`,
        [quoteNo, vDate, String(payload.client), String(payload.contact || ""),
         String(payload.project || ""), String(payload.mall || ""),
         String(payload.lot || ""), String(payload.location || ""),
         n(payload.validity), vStatus,
         round4(vLength), round4(vHeight), round4(vDoors),
         round2(hoardTotal), round2(gateTotal), round2(vSub),
         round4(vSstPct), round2(vSstAmt), round2(vGrand),
         JSON.stringify(data), user.email, id]);
      await logAudit(conn, user.email, "HRD UPDATE Quote",
        quoteNo + " · " + payload.client + " / RM " + fmtRM(vGrand));
    } else {
      id = crypto.randomUUID();
      await conn.query(
        `INSERT INTO hrd_quotes (id, quote_no, quote_date, client, contact, project,
           mall, lot, location, validity, status, length, height, doors,
           hoarding_total, gate_total, subtotal, sst_pct, sst_amount, grand_total,
           data, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, quoteNo, vDate, String(payload.client), String(payload.contact || ""),
         String(payload.project || ""), String(payload.mall || ""),
         String(payload.lot || ""), String(payload.location || ""),
         n(payload.validity), vStatus,
         round4(vLength), round4(vHeight), round4(vDoors),
         round2(hoardTotal), round2(gateTotal), round2(vSub),
         round4(vSstPct), round2(vSstAmt), round2(vGrand),
         JSON.stringify(data), user.email, user.email]);
      // bumpQuoteSeq_: trailing digits of the number used, if > stored QUOTE_SEQ
      const m = /(\d+)\s*$/.exec(quoteNo);
      if (m) {
        const cur = parseInt(s(await cfg(conn, "QUOTE_SEQ")) || "0", 10) || 0;
        const used = parseInt(m[1], 10);
        if (used > cur) {
          await conn.query(
            "INSERT INTO hrd_config (`key`, `value`) VALUES ('QUOTE_SEQ', ?) " +
            "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
            [String(used)]);
        }
      }
      await logAudit(conn, user.email, "HRD CREATE Quote",
        quoteNo + " · " + payload.client + " / RM " + fmtRM(vGrand));
    }

    return { id, quote_no: quoteNo };
  },

  // hrd_edit_material_price({ p_code, p_field, p_value, p_reason }) → null
  // Atomic: catalog update + hrd_price_history row + audit.
  // Form sends markup as % (40) — stored as fraction (0.4).
  hrd_edit_material_price: async ({ args, user, conn }) => {
    const code = String(args.p_code || "");
    const field = String(args.p_field || "");
    if (field !== "costPrice" && field !== "markup") throw new Error("Bad field.");
    let vNew = n(args.p_value);
    if (field === "markup") vNew = vNew / 100;

    const [rows] = await conn.query(
      "SELECT cost_price, markup FROM hrd_materials WHERE code = ? FOR UPDATE", [code]);
    if (!rows.length) throw new Error("Material not found.");
    const vOld = field === "markup" ? n(rows[0].markup) : n(rows[0].cost_price);
    if (Math.abs(vOld - vNew) < 1e-9) return null;   // no-op, same as plpgsql early return

    let oldDisp, newDisp, fieldDisp;
    if (field === "markup") {
      await conn.query(
        "UPDATE hrd_materials SET markup = ?, updated_at = NOW(), updated_by = ? WHERE code = ?",
        [vNew, user.email, code]);
      oldDisp = vOld * 100; newDisp = vNew * 100; fieldDisp = "Markup %";
    } else {
      await conn.query(
        "UPDATE hrd_materials SET cost_price = ?, updated_at = NOW(), updated_by = ? WHERE code = ?",
        [vNew, user.email, code]);
      oldDisp = vOld; newDisp = vNew; fieldDisp = "Cost Price";
    }

    await conn.query(
      "INSERT INTO hrd_price_history (code, field, old_val, new_val, user_email, reason) VALUES (?, ?, ?, ?, ?, ?)",
      [code, fieldDisp, oldDisp, newDisp, user.email, String(args.p_reason || "")]);

    const reason = String(args.p_reason || "");
    await logAudit(conn, user.email, "HRD PRICE-CHANGE Material",
      code + " · " +
      (field === "markup"
        ? oldDisp + "% -> " + newDisp + "%"
        : "RM" + oldDisp + " -> RM" + newDisp) +
      (reason !== "" ? " (" + reason + ")" : ""));
    return null;
  },

  // hrd_apply_supplier({ p_id }) → null
  // Copies a supplier price into hrd_materials.cost_price + history + audit.
  hrd_apply_supplier: async ({ args, user, conn }) => {
    const id = String(args.p_id || "");
    const [sRows] = await conn.query("SELECT * FROM hrd_supplier_prices WHERE id = ?", [id]);
    if (!sRows.length) throw new Error("Supplier price not found.");
    const sup = sRows[0];
    const supCost = n(sup.cost_price);

    const [mRows] = await conn.query(
      "SELECT cost_price FROM hrd_materials WHERE code = ? FOR UPDATE", [sup.code]);
    if (!mRows.length) throw new Error("Material " + sup.code + " not in catalog.");
    const vOld = n(mRows[0].cost_price);

    await conn.query(
      "UPDATE hrd_materials SET cost_price = ?, updated_at = NOW(), updated_by = ? WHERE code = ?",
      [supCost, user.email, sup.code]);
    await conn.query(
      "INSERT INTO hrd_price_history (code, field, old_val, new_val, user_email, reason) VALUES (?, ?, ?, ?, ?, ?)",
      [sup.code, "Cost Price", vOld, supCost, user.email, "Applied supplier: " + sup.supplier]);
    await logAudit(conn, user.email, "HRD PRICE-CHANGE Material",
      sup.code + " · RM" + vOld + " -> RM" + supCost + " (supplier " + sup.supplier + ")");
    return null;
  },
};
