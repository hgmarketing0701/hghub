// server/rpcs/storage.js — temporary-storage-rental RPC pack.
// Port of str_generate_monthly() from supabase/schema-storage-rental.sql (plpgsql).
// Registry contract (server/rpc.js): each fn gets ({ args, user, conn }) with an
// OPEN transaction — use conn.query only, throw to roll back.

const crypto = require("crypto");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const ymd = (d) => d.toISOString().slice(0, 10);
// KL is fixed UTC+8 (no DST) — shift, then read the UTC calendar date.
const klToday = () => ymd(new Date(Date.now() + 8 * 3600e3));

// str_generate_monthly({ p_month: 'YYYY-MM' }) → { month, count, created: [] }
// Auto monthly invoicing (was GAS generateMonthlyInvoices / plpgsql RPC):
// one invoice per active Client rental with monthly_rate > 0 active in the
// month. Skips Internal engagements, Vacated/SoldOff/Released rentals, and
// rentals already invoiced for the same period_from (status <> 'Void').
// Sequential STR-#### numbers via str_config INVOICE_PREFIX + INVOICE_SEQ —
// the SELECT ... FOR UPDATE on str_config serialises concurrent runs, and the
// UNIQUE key on str_invoices.inv_no backstops any manually-typed collisions.
async function str_generate_monthly({ args, user, conn }) {
  const pMonth = String(args.p_month || "");
  if (!/^\d{4}-\d{2}$/.test(pMonth)) throw new Error("Month must be YYYY-MM.");

  const [y, m] = pMonth.split("-").map(Number);
  if (m < 1 || m > 12) throw new Error("Month must be YYYY-MM.");
  const from = pMonth + "-01";
  const to = ymd(new Date(Date.UTC(y, m, 0)));   // last day of the month
  const label = MONTHS[m - 1] + " " + y;          // to_char(v_from,'Mon YYYY')
  const today = klToday();

  // Lock the config rows for the whole run → atomic invoice numbering
  // (replaces the plpgsql function's implicit serialisation).
  const [cfgRows] = await conn.query(
    "SELECT `key`, `value` FROM str_config WHERE `key` IN " +
    "('INVOICE_TERMS_DAYS','AUTO_INVOICE_SST','INVOICE_PREFIX','INVOICE_SEQ') FOR UPDATE"
  );
  const cfg = {};
  for (const row of cfgRows) cfg[row.key] = row.value;

  // coalesce(nullif(value,'')::int, 7)
  let terms = (cfg.INVOICE_TERMS_DAYS != null && cfg.INVOICE_TERMS_DAYS !== "")
    ? parseInt(cfg.INVOICE_TERMS_DAYS, 10) : 7;
  if (!Number.isFinite(terms)) terms = 7;
  // coalesce(value,'1') in ('1','true','TRUE') — missing row ⇒ true
  const autosst = ("AUTO_INVOICE_SST" in cfg)
    ? ["1", "true", "TRUE"].includes(String(cfg.AUTO_INVOICE_SST == null ? "1" : cfg.AUTO_INVOICE_SST))
    : true;
  const prefix = (cfg.INVOICE_PREFIX != null && cfg.INVOICE_PREFIX !== "")
    ? String(cfg.INVOICE_PREFIX) : "STR-";
  let seq = (cfg.INVOICE_SEQ != null && cfg.INVOICE_SEQ !== "")
    ? parseInt(cfg.INVOICE_SEQ, 10) : 0;
  if (!Number.isFinite(seq)) seq = 0;

  const due = ymd(new Date(Date.UTC(y, m - 1, 1 + terms)));  // v_from + terms days

  const [rentals] = await conn.query(
    "SELECT id, lot_id, client_company, monthly_rate FROM str_rentals " +
    "WHERE engagement_type <> 'Internal' " +
    "  AND status NOT IN ('Vacated','SoldOff','Released') " +
    "  AND COALESCE(monthly_rate, 0) > 0 " +
    "  AND (start_date IS NULL OR start_date <= ?) " +
    "  AND (end_date   IS NULL OR end_date   >= ?) " +
    "ORDER BY lot_id",
    [to, from]
  );

  let count = 0;
  const created = [];

  for (const r of rentals) {
    // already invoiced for this period (non-Void)?
    const [dup] = await conn.query(
      "SELECT 1 FROM str_invoices WHERE rental_id = ? AND period_from = ? AND status <> 'Void' LIMIT 1",
      [r.id, from]
    );
    if (dup.length) continue;

    // next unused sequential number (utf8mb4_unicode_ci ⇒ case-insensitive match,
    // same as the Postgres lower(inv_no) unique index)
    let invNo;
    for (;;) {
      seq += 1;
      invNo = prefix + String(seq).padStart(4, "0");
      const [used] = await conn.query(
        "SELECT 1 FROM str_invoices WHERE inv_no = ? LIMIT 1", [invNo]
      );
      if (!used.length) break;
    }

    const amount = r2(r.monthly_rate);            // DECIMAL arrives as string
    const sst = autosst ? r2(amount * 0.06) : 0;
    const total = r2(amount + sst);
    const client = r.client_company == null ? "" : String(r.client_company);
    const lot = r.lot_id == null ? "" : String(r.lot_id);

    await conn.query(
      "INSERT INTO str_invoices (id, inv_no, rental_id, lot_id, client_company, inv_date, due_date, " +
      " period_from, period_to, description, amount, sst_enabled, sst_amount, total, status, notes, created_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'Auto-generated', ?)",
      [crypto.randomUUID(), invNo, r.id, lot, client, today, due, from, to,
       "Storage rental — Lot " + lot + " · " + label,
       amount, autosst ? 1 : 0, sst, total, "auto/" + user.email]
    );

    count += 1;
    created.push(invNo + " · " + client + " (Lot " + lot + ")");
    // perform log_audit('AUTO_INVOICE', …)
    await conn.query(
      "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, 'AUTO_INVOICE', ?)",
      [user.email, invNo + " · " + client + " · " + label + " · RM" + total.toFixed(2)]
    );
  }

  // persist the advanced sequence (update + insert-if-missing, as in plpgsql)
  await conn.query(
    "INSERT INTO str_config (`key`, `value`) VALUES ('INVOICE_SEQ', ?) " +
    "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
    [String(seq)]
  );

  return { month: pMonth, count, created };
}

module.exports = { str_generate_monthly };
