// server/rpcs/claims.js — JS ports of supabase/schema-claims.sql plpgsql RPCs.
// Registered by server/rpc.js: each fn gets ({ args, user, conn }) inside an
// OPEN TRANSACTION — use ONLY conn.query, throw on failure (route rolls back).
//
// user = { sub, email, name, role }  (role === 'admin' replaces is_admin();
// requireAuth on the router replaces is_allowed(); user.email = current_email()).
//
// MySQL notes: DECIMAL arrives as string (coerce via Number()), DATE arrives as
// 'YYYY-MM-DD' string (dateStrings: true), ids are CHAR(36) from crypto.randomUUID().

const crypto = require("crypto");

const CATS = ["food", "grocery", "apparel", "fuel", "transport",
              "accommodation", "materials", "tools", "office", "other"];

function round2(x) { return Math.round((Number(x) + Number.EPSILON) * 100) / 100; }

// Asia/Kuala_Lumpur is UTC+8, no DST — matches (now() at time zone 'Asia/Kuala_Lumpur')
function klNow() { return new Date(Date.now() + 8 * 3600 * 1000); }
function klToday() { return klNow().toISOString().slice(0, 10); }
function klYear() { return klToday().slice(0, 4); }

function pad3(n) { return String(n).padStart(3, "0"); }

async function logAudit(conn, user, action, details) {
  await conn.query(
    "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, ?, ?)",
    [user.email, action, details]
  );
}

// Atomic sequential number 'PREFIX-YYYY-###' (was: select max(substring(no from 10))
// in plpgsql, serialized by Postgres row locks). SELECT ... FOR UPDATE locks the
// matching index range so two concurrent submits cannot mint the same number.
async function nextSeqNo(conn, table, col, prefix) {
  const year = klYear();
  const like = `${prefix}-${year}-%`;
  const [rows] = await conn.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${col}, 10) AS UNSIGNED)), 0) + 1 AS next
       FROM ${table}
      WHERE ${col} LIKE ?
        AND SUBSTRING(${col}, 10) REGEXP '^[0-9]+$'
      FOR UPDATE`,
    [like]
  );
  return `${prefix}-${year}-${pad3(Number(rows[0].next))}`;
}

module.exports = {

  // ── clm_submit_claim(payload jsonb) ───────────────────────────────────────
  // payload: { vendor, receiptDate, currency, sstEnabled, serviceCharge,
  //            subsidyAmount, roundingAdjustment, remarks, receiptPaths:[...],
  //            lines: [{description, quantity, unitPrice, category, remarks}] }
  // Server-side recompute of ALL maths (never trusts client), atomic CLM-YYYY-###,
  // inserts claim + lines, audit log. Returns the same jsonb shape as plpgsql.
  clm_submit_claim: async ({ args, user, conn }) => {
    const payload = args.payload || args || {};
    const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
    const receiptPaths = Array.isArray(payload.receiptPaths) ? payload.receiptPaths : [];

    if (rawLines.length === 0) throw new Error("At least one line item required.");
    if (receiptPaths.length === 0) throw new Error("At least one receipt image required.");

    // recompute every line (qty × unit price) — same rules as the GAS/plpgsql server
    let subtotal = 0;
    const lines = rawLines.map((l, i) => {
      const qty = Number(l.quantity) || 0;
      const unit = Number(l.unitPrice) || 0;
      const amt = round2(qty * unit);
      let cat = String(l.category || "other").toLowerCase();
      if (!CATS.includes(cat)) cat = "other";
      subtotal += amt;
      return {
        description: String(l.description || "").trim(),
        quantity: qty, unitPrice: unit, lineAmount: amt,
        category: cat, remarks: String(l.remarks || ""), sort: i + 1
      };
    });
    subtotal = round2(subtotal);

    const sc = Math.max(0, round2(payload.serviceCharge || 0));
    const subsidy = Math.max(0, round2(payload.subsidyAmount || 0));
    const rounding = round2(payload.roundingAdjustment || 0);
    const taxBase = Math.max(0, subtotal + sc - subsidy);

    let sst = 0;
    if (payload.sstEnabled === true || payload.sstEnabled === "true") {
      const [srows] = await conn.query(
        "SELECT value FROM app_settings WHERE `key` = 'SST_PERCENT'"
      );
      const pct = srows.length && srows[0].value !== "" && !isNaN(Number(srows[0].value))
        ? Number(srows[0].value) : 6;
      sst = round2(taxBase * pct / 100);
    }
    const total = round2(subtotal + sc - subsidy + sst + rounding);

    // primary category = category covering the largest share of the total
    const byCat = {};
    for (const l of lines) byCat[l.category] = (byCat[l.category] || 0) + l.lineAmount;
    let primary = "other", best = -Infinity;
    for (const [cat, s] of Object.entries(byCat)) {
      if (s > best) { best = s; primary = cat; }
    }

    const vendor = String(payload.vendor || "").trim() || "Unknown vendor";
    const currency = String(payload.currency || "").trim() || "RM";
    const receiptDate = String(payload.receiptDate || "").trim() || klToday();

    // atomic sequential claim number: CLM-YYYY-###
    const claimNo = await nextSeqNo(conn, "clm_claims", "claim_no", "CLM");

    const id = crypto.randomUUID();
    await conn.query(
      `INSERT INTO clm_claims
         (id, claim_no, submitted_by, receipt_date, vendor, currency,
          subtotal, service_charge, subsidy_amount, sst_amount,
          rounding_adjustment, total, primary_category, status,
          receipt_paths, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)`,
      [id, claimNo, user.email, receiptDate, vendor, currency,
       subtotal, sc, subsidy, sst,
       rounding, total, primary,
       JSON.stringify(receiptPaths), String(payload.remarks || ""), user.email]
    );

    // lines inserted with the parent, inside the same transaction
    for (const l of lines) {
      await conn.query(
        `INSERT INTO clm_claim_lines
           (id, claim_id, description, quantity, unit_price, line_amount, category, remarks, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), id, l.description, l.quantity, l.unitPrice,
         l.lineAmount, l.category, l.remarks, l.sort]
      );
    }

    await logAudit(conn, user, "claim.create",
      `${claimNo} · ${vendor} · ${currency} ${total.toFixed(2)} · ${lines.length} line(s)`);

    return {
      id, claimNo, vendor, currency,
      subtotal, serviceCharge: sc, subsidyAmount: subsidy,
      sstAmount: sst, roundingAdjustment: rounding, total,
      primaryCategory: primary, receiptDate
    };
  },

  // ── clm_generate_summary(payload jsonb) ───────────────────────────────────
  // payload: { claimNos: ['CLM-2026-001', ...], title?, remarks? }
  // Bundles selected claims (owner-scoped; admin sees all) into an atomic
  // SUM-YYYY-### summary: count, grand total, dominant currency, period range.
  clm_generate_summary: async ({ args, user, conn }) => {
    const payload = args.payload || args || {};
    const nos = (Array.isArray(payload.claimNos) ? payload.claimNos : [])
      .map(String).filter(Boolean);
    if (nos.length === 0) throw new Error("Pick at least one claim to summarise.");

    const isAdmin = user.role === "admin";
    const scopeSql = isAdmin ? "" : " AND LOWER(submitted_by) = LOWER(?)";
    const ph = nos.map(() => "?").join(",");
    const params = isAdmin ? nos : [...nos, user.email];

    // claims visible to this user only (admin sees all) — was RLS + WHERE in plpgsql
    const [rows] = await conn.query(
      `SELECT claim_no, currency, total, receipt_date
         FROM clm_claims
        WHERE claim_no IN (${ph})${scopeSql}`,
      params
    );

    if (rows.length === 0) throw new Error("None of the selected claims were found.");

    const found = new Set(rows.map(r => r.claim_no));
    const missing = nos.filter(n => !found.has(n));
    if (missing.length) throw new Error("Not found: " + missing.join(", "));

    const count = rows.length;
    const grand = round2(rows.reduce((s, r) => s + (Number(r.total) || 0), 0));
    const dates = rows.map(r => String(r.receipt_date)).filter(Boolean).sort();
    const from = dates[0] || null;
    const to = dates[dates.length - 1] || null;

    // primary currency = the one carrying the largest share of the total
    const byCur = {};
    for (const r of rows) byCur[r.currency] = (byCur[r.currency] || 0) + (Number(r.total) || 0);
    let currency = "RM", best = -Infinity;
    for (const [cur, s] of Object.entries(byCur)) {
      if (s > best) { best = s; currency = cur; }
    }

    // atomic sequential summary number: SUM-YYYY-###
    const summaryNo = await nextSeqNo(conn, "clm_summaries", "summary_no", "SUM");

    const id = crypto.randomUUID();
    const title = String(payload.title || "").trim();
    await conn.query(
      `INSERT INTO clm_summaries
         (id, summary_no, generated_by, claim_nos, claim_count,
          currency, grand_total, period_from, period_to, title, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, summaryNo, user.email, nos.join(" | "), count,
       currency, grand, from, to, title,
       String(payload.remarks || "").trim(), user.email]
    );

    await logAudit(conn, user, "summary.create",
      `${summaryNo} · ${count} claim(s) · ${currency} ${grand.toFixed(2)}`);

    return {
      id, summaryNo, claimCount: count, currency,
      grandTotal: grand, periodFrom: from, periodTo: to, title
    };
  }
};
