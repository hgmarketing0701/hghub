// server/rpcs/subcon.js — subcon-invoice-generator RPC pack.
// Port of sci_save_invoice(payload jsonb) from supabase/schema-subcon-invoice.sql
// (plpgsql, itself a port of GAS saveInvoice()). Registry contract (server/rpc.js):
// each fn gets ({ args, user, conn }) with an OPEN transaction — use conn.query
// only, throw to roll back.

const crypto = require("crypto");

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
// KL is fixed UTC+8 (no DST) — shift, then read the UTC calendar date.
const klToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const trim = (v) => String(v == null ? "" : v).trim();

// sci_save_invoice({ payload }) → { id, invNo, subtotal, sstAmount, total }
// payload: { invNo, invDate, ref, issuerType, issuerName, issuerIc, issuerAddr,
//            issuerPhone, issuerEmail, billToName, billToAddr, sstEnabled,
//            payInfo, notes, logoPath, lines: [{description, quantity, unitPrice}] }
// Recomputes every line server-side (never trusts client maths), SST fixed at
// 6% when enabled, atomic next SUB-YYYY-#### number, upserts the subcon on
// (type, lower(name)), persists the SCI_MY_COMPANY_* bill-to defaults, inserts
// invoice + lines, logs 'invoice.create' to audit_log.
async function sci_save_invoice({ args, user, conn }) {
  const p = (args && args.payload) || {};

  const sstOn = p.sstEnabled === true || p.sstEnabled === "true" || p.sstEnabled === 1;
  const type = p.issuerType === "co" ? "co" : "ind";
  const name = trim(p.issuerName);
  if (name === "") throw new Error("Issuer name is required.");
  const rawLines = Array.isArray(p.lines) ? p.lines : [];
  if (rawLines.length === 0) throw new Error("At least one line item is required.");

  // recompute lines server-side; drop fully-empty rows (same filter as GAS)
  const lines = [];
  let subtotal = 0;
  for (const l of rawLines) {
    const line = l || {};
    const qty = Number(line.quantity) || 0;
    const unit = Number(line.unitPrice) || 0;
    const desc = trim(line.description);
    if (desc === "" && unit === 0 && qty === 0) continue;
    const amt = r2(qty * unit);
    subtotal += amt;
    lines.push({ description: desc, quantity: qty, unitPrice: unit,
                 lineAmount: amt, sort: lines.length + 1 });
  }
  if (lines.length === 0) throw new Error("At least one line item with an amount is required.");

  subtotal = r2(subtotal);
  const sst = sstOn ? r2(subtotal * 0.06) : 0;
  const total = r2(subtotal + sst);

  // invoice number: keep a typed one, else next SUB-YYYY-#### for this year.
  // The FOR UPDATE range-locks this year's numbers (InnoDB next-key locking
  // blocks concurrent inserts into the range until commit) — replaces
  // pg_advisory_xact_lock / GAS LockService; the UNIQUE key on inv_no backstops.
  const year = klToday().slice(0, 4);
  let invNo = trim(p.invNo);
  if (invNo === "") {
    const [rows] = await conn.query(
      "SELECT inv_no FROM sci_invoices WHERE inv_no LIKE ? FOR UPDATE",
      ["SUB-" + year + "-%"]
    );
    const re = new RegExp("^SUB-" + year + "-(\\d+)$");
    let max = 0;
    for (const row of rows) {
      const mm = re.exec(row.inv_no);
      if (mm) max = Math.max(max, parseInt(mm[1], 10));
    }
    invNo = "SUB-" + year + "-" + String(max + 1).padStart(4, "0");
  }

  const ic = trim(p.issuerIc);
  const addr = trim(p.issuerAddr);
  const phone = trim(p.issuerPhone);
  const email = trim(p.issuerEmail);
  const payInfo = p.payInfo == null ? "" : String(p.payInfo);
  const notes = p.notes == null ? "" : String(p.notes);
  const logo = trim(p.logoPath);
  const btName = trim(p.billToName);
  const btAddr = trim(p.billToAddr);

  // remember / update the subcon — same (type, lower(name)) identity as GAS
  // upsertSubcon_ (utf8mb4_unicode_ci is already case-insensitive; LOWER kept explicit)
  const [subs] = await conn.query(
    "SELECT id FROM sci_subcons WHERE type = ? AND LOWER(name) = LOWER(?) LIMIT 1",
    [type, name]
  );
  if (subs.length === 0) {
    await conn.query(
      "INSERT INTO sci_subcons (id, type, name, ic, addr, phone, email, pay_info, logo_path) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), type, name, ic, addr, phone, email, payInfo, logo]
    );
  } else {
    await conn.query(
      "UPDATE sci_subcons SET ic = ?, addr = ?, phone = ?, email = ?, pay_info = ?, " +
      " logo_path = CASE WHEN ? <> '' THEN ? ELSE logo_path END, updated_at = NOW() " +
      "WHERE id = ?",
      [ic, addr, phone, email, payInfo, logo, logo, subs[0].id]
    );
  }

  // persist "Bill to" company default for next time (was Script Property)
  if (btName !== "" || btAddr !== "") {
    await conn.query(
      "INSERT INTO app_settings (`key`, `value`) VALUES " +
      "('SCI_MY_COMPANY_NAME', ?), ('SCI_MY_COMPANY_ADDR', ?) " +
      "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
      [btName, btAddr]
    );
  }

  const id = crypto.randomUUID();
  const invDate = trim(p.invDate) !== "" ? trim(p.invDate) : klToday();
  await conn.query(
    "INSERT INTO sci_invoices (id, inv_no, inv_date, ref, issuer_type, issuer_name, issuer_ic, " +
    " issuer_addr, issuer_phone, issuer_email, bill_to_name, bill_to_addr, " +
    " subtotal, sst_enabled, sst_amount, total, pay_info, notes, created_by) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, invNo, invDate, trim(p.ref), type, name, ic, addr, phone, email,
     btName, btAddr, subtotal, sstOn ? 1 : 0, sst, total, payInfo, notes, user.email]
  );

  const placeholders = lines.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
  const values = [];
  for (const l of lines) {
    values.push(crypto.randomUUID(), id, l.description, l.quantity, l.unitPrice, l.lineAmount, l.sort);
  }
  await conn.query(
    "INSERT INTO sci_invoice_lines (id, invoice_id, description, quantity, unit_price, line_amount, sort) " +
    "VALUES " + placeholders,
    values
  );

  // perform log_audit('invoice.create', …) — FM999999990.00 ⇒ plain 2dp, no commas
  await conn.query(
    "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, 'invoice.create', ?)",
    [user.email, invNo + " · " + name + " · RM " + total.toFixed(2) + " · " + lines.length + " line(s)"]
  );

  return { id, invNo, subtotal, sstAmount: sst, total };
}

module.exports = { sci_save_invoice };
