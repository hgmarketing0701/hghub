// RPC pack: quotation — port of supabase/schema.sql save_quote() (plpgsql).
// Registered by server/rpc.js; each fn runs inside an open transaction on `conn`.

const { randomUUID } = require("crypto");

// money-safe 2dp rounding
const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

// KL is UTC+8, no DST — current year in Asia/Kuala_Lumpur
const klYear = () => String(new Date(Date.now() + 8 * 3600 * 1000).getUTCFullYear());

// port of plpgsql trim(both '; ' from s) — strips ';' and ' ' chars from both ends
const trimSemi = (s) => String(s || "").replace(/^[;\s]+/, "").replace(/[;\s]+$/, "");

// numeric → text like postgres (no trailing .0 for whole numbers)
const numTxt = (n) => String(Number(n));

module.exports = {
  // save_quote({ payload }) → quote id (uuid string; tool does getQuote(r.data))
  // payload: { mall, clientName, clientType, attention, project, notes, applySST,
  //            lines: [{service, subScope, item, unit, qty, rate, minQty, minCharge, note}] }
  save_quote: async ({ args, user, conn }) => {
    const payload = args.payload || {};
    const mall = String(payload.mall || "").trim();
    const clientName = String(payload.clientName || "").trim();
    const lines = Array.isArray(payload.lines) ? payload.lines : [];

    if (!mall) throw new Error("Select a mall.");
    if (!clientName) throw new Error("Enter the client name.");
    if (lines.length === 0) throw new Error("Add at least one line item.");

    // SST percent from app_settings (only when applySST)
    let sstPct = 0;
    if (payload.applySST === true || payload.applySST === "true") {
      const [rows] = await conn.query(
        "SELECT value FROM app_settings WHERE `key` = 'SST_PERCENT'"
      );
      const v = rows.length ? String(rows[0].value || "").trim() : "";
      sstPct = v !== "" && !isNaN(Number(v)) ? Number(v) : 6;
    }

    // recompute every line (min-qty / min-charge rules) — never trust client maths
    let subtotal = 0;
    let sort = 0;
    const computed = [];
    for (const line of lines) {
      const qty = Number(line.qty) || 0;
      const rate = Number(line.rate) || 0;
      const minQty = Number(line.minQty) || 0;
      const minCharge = Number(line.minCharge) || 0;
      let effQty = qty;
      let note = String(line.note || "");

      if (minQty > 0 && qty > 0 && qty < minQty) {
        effQty = minQty;
        note = trimSemi(note + "; min " + numTxt(minQty) + " " + String(line.unit || ""));
      }
      let amount = r2(effQty * rate);
      if (minCharge > 0 && amount < minCharge) {
        amount = r2(minCharge);
        note = trimSemi(note + "; min charge RM" + numTxt(minCharge));
      }

      subtotal += amount;
      sort += 1;
      computed.push({
        service: String(line.service || ""),
        subScope: String(line.subScope || ""),
        item: line.item == null ? null : String(line.item),
        unit: String(line.unit || ""),
        qty: effQty,
        rate,
        amount,
        note,
        sort,
      });
    }

    subtotal = r2(subtotal);
    const sst = r2((subtotal * sstPct) / 100);
    const total = r2(subtotal + sst);

    // atomic sequential quote number: <QUOTE_PREFIX>-YYYY-### (KL year)
    const [pfxRows] = await conn.query(
      "SELECT value FROM app_settings WHERE `key` = 'QUOTE_PREFIX'"
    );
    let prefix = pfxRows.length && String(pfxRows[0].value || "").trim() !== ""
      ? String(pfxRows[0].value).trim()
      : "HG-Q";
    prefix = prefix + "-" + klYear() + "-";

    // FOR UPDATE locks the matching index range so concurrent saves serialize
    const [noRows] = await conn.query(
      "SELECT quote_no FROM quotes WHERE quote_no LIKE ? FOR UPDATE",
      [prefix + "%"]
    );
    let maxN = 0;
    for (const row of noRows) {
      const tail = String(row.quote_no).slice(prefix.length);
      if (/^[0-9]+$/.test(tail)) maxN = Math.max(maxN, parseInt(tail, 10));
    }
    const quoteNo = prefix + String(maxN + 1).padStart(3, "0");

    const qid = randomUUID();
    await conn.query(
      `INSERT INTO quotes (id, quote_no, mall, client_name, client_type, attention, project,
                           subtotal, sst_pct, sst, total, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?)`,
      [
        qid, quoteNo, mall, clientName,
        String(payload.clientType || "Mall"),
        String(payload.attention || ""),
        String(payload.project || ""),
        subtotal, sstPct, sst, total,
        String(payload.notes || ""),
        user.email,
      ]
    );

    for (const l of computed) {
      await conn.query(
        `INSERT INTO quote_lines (id, quote_id, service, sub_scope, item, unit, qty, rate, amount, note, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), qid, l.service, l.subScope, l.item, l.unit, l.qty, l.rate, l.amount, l.note, l.sort]
      );
    }

    // log_audit('SAVE QUOTE', ...) — details truncated to 300 chars like the SQL fn
    const details = (quoteNo + " · " + mall + " · " + clientName + " · RM" + total).slice(0, 300);
    await conn.query(
      "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, 'SAVE QUOTE', ?)",
      [user.email, details]
    );

    return qid;
  },
};
