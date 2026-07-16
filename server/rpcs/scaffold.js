// scaffold RPC pack — port of supabase/schema-scaffold.sql plpgsql functions + alarms view.
//   scf_next_job_no()            → 'JOB-0001'   (JOB_PREFIX setting, 4-digit seq)
//   scf_next_invoice_no()        → 'HG-INV0001' (INVOICE_PREFIX setting, 4-digit seq)
//   scf_invoice_from_charges({payload}) → new invoice uuid (atomic, server recompute)
//   scf_alarms()                 → rows of the old Postgres scf_alarms VIEW
//                                  (alarm_type, ref, detail, due_date, recipient)
//
// Registered via server/rpc.js — each fn receives ({ args, user, conn }) with conn
// inside an open transaction (commit/rollback handled by the route wrapper).
// scf_alarms only reads, so server/cron.js may also call it with { conn: pool }.
//
// db.js sets dateStrings:true — DATE columns arrive as 'YYYY-MM-DD' strings.
// DECIMAL columns arrive as strings — coerced with Number() at use-site.

const { randomUUID } = require("crypto");

// ---- small helpers ---------------------------------------------------------

const num = (v) => Number(v || 0);
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// (now() at time zone 'Asia/Kuala_Lumpur')::date
const todayMYT = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

// whole-day difference a - b for 'YYYY-MM-DD' strings (Postgres date subtraction)
const dayDiff = (a, b) =>
  Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);

// dateStr + n days → 'YYYY-MM-DD'
const addDays = (dateStr, n) => {
  const t = new Date(Date.parse(dateStr + "T00:00:00Z") + n * 86400000);
  return t.toISOString().slice(0, 10);
};

// to_char(x, 'FM999G999G990.00') — thousands groups + always 2 decimals
const fmtRM = (v) =>
  Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// read one scf_settings value ('' when missing)
async function setting(conn, key) {
  const [rows] = await conn.query(
    "SELECT `value` FROM scf_settings WHERE `key` = ?", [key]
  );
  return rows[0] && rows[0].value !== null ? String(rows[0].value) : "";
}

// coalesce(nullif(value,'')::int, def) — non-numeric also falls back
async function settingInt(conn, key, def) {
  const v = await setting(conn, key);
  const n = parseInt(v, 10);
  return v !== "" && Number.isFinite(n) ? n : def;
}

// PREFIX + 4-digit max+1 over numeric suffixes; FOR UPDATE serialises
// concurrent minting inside the surrounding transaction.
async function nextSeq(conn, table, column, prefix) {
  const pos = prefix.length + 1;
  const [rows] = await conn.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${column}, ?) AS UNSIGNED)), 0) + 1 AS n
       FROM ${table}
      WHERE ${column} LIKE CONCAT(?, '%')
        AND SUBSTRING(${column}, ?) REGEXP '^[0-9]+$'
      FOR UPDATE`,
    [pos, prefix, pos]
  );
  return prefix + String(rows[0].n).padStart(4, "0");
}

async function nextJobNo(conn) {
  const v = await setting(conn, "JOB_PREFIX");
  return nextSeq(conn, "scf_engagements", "job_no", v !== "" ? v : "JOB-");
}

async function nextInvoiceNo(conn) {
  const v = await setting(conn, "INVOICE_PREFIX");
  return nextSeq(conn, "scf_invoices", "inv_no", v !== "" ? v : "HG-INV");
}

// ---- scf_next_job_no / scf_next_invoice_no ---------------------------------

async function scf_next_job_no({ conn }) {
  return nextJobNo(conn); // text, e.g. 'JOB-0042'
}

async function scf_next_invoice_no({ conn }) {
  return nextInvoiceNo(conn); // text, e.g. 'HG-INV0007'
}

// ---- scf_invoice_from_charges ----------------------------------------------
// payload: { engagementId, sstEnabled (default true), invNo?, invDate?, dueDate? }
// Collects every uninvoiced charge on the job, recomputes totals server-side,
// creates the invoice atomically and stamps the charges with the invoice id.

const CHARGE_LABEL = {
  PE:         "PE calculation & endorsement",
  Rental:     "Scaffold rental",
  Install:    "Scaffold installation",
  Transport:  "Lorry transport (delivery/pickup)",
  Dismantle:  "Scaffold dismantling",
  GreenTag:   "Green tag endorsement",
  ThirdParty: "3rd-party supplier",
};

async function scf_invoice_from_charges({ args, user, conn }) {
  const p = args.payload || args || {};
  const sstOn = p.sstEnabled === undefined || p.sstEnabled === null
    ? true : Boolean(p.sstEnabled);

  const [engRows] = await conn.query(
    "SELECT * FROM scf_engagements WHERE id = ? FOR UPDATE",
    [String(p.engagementId || "")]
  );
  const eng = engRows[0];
  if (!eng) throw new Error("Job not found.");

  // lock + collect the uninvoiced charges (description order = created_at)
  const [charges] = await conn.query(
    `SELECT id, type, description, amount, created_at
       FROM scf_charges
      WHERE engagement_id = ? AND invoice_id IS NULL
      ORDER BY created_at
      FOR UPDATE`,
    [eng.id]
  );
  if (charges.length === 0) throw new Error("No uninvoiced charges on this job.");

  const amount = round2(charges.reduce((sum, c) => sum + num(c.amount), 0));

  const rate  = (await settingInt(conn, "SST_RATE_PCT", 6)) / 100;
  const sst   = sstOn ? round2(amount * rate) : 0;
  const total = round2(amount + sst);

  const invDate = p.invDate && String(p.invDate) !== "" ? String(p.invDate) : todayMYT();
  const terms   = await settingInt(conn, "INVOICE_TERMS_DAYS", 30);
  const dueDate = p.dueDate && String(p.dueDate) !== "" ? String(p.dueDate) : addDays(invDate, terms);

  const desc = charges.map((c) => {
    const label = CHARGE_LABEL[c.type] || (c.type ? String(c.type) : "Other");
    const extra = c.description && String(c.description) !== "" ? " (" + c.description + ")" : "";
    return label + extra + " — RM " + fmtRM(num(c.amount));
  }).join("\n");

  const invNo = p.invNo && String(p.invNo) !== "" ? String(p.invNo) : await nextInvoiceNo(conn);
  const [dup] = await conn.query(
    "SELECT id FROM scf_invoices WHERE LOWER(inv_no) = LOWER(?) LIMIT 1", [invNo]
  );
  if (dup.length) throw new Error("Invoice number " + invNo + " already exists.");

  const id = randomUUID();
  await conn.query(
    `INSERT INTO scf_invoices
       (id, inv_no, engagement_id, client_company, inv_date, due_date,
        description, amount, sst_enabled, sst_amount, total, status, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, invNo, eng.id, eng.client_company, invDate, dueDate,
     desc, amount, sstOn ? 1 : 0, sst, total, "",
     "From " + charges.length + " charge line(s) · Job " + eng.job_no, user.email]
  );

  await conn.query(
    "UPDATE scf_charges SET invoice_id = ? WHERE engagement_id = ? AND invoice_id IS NULL",
    [id, eng.id]
  );

  await conn.query(
    "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, ?, ?)",
    [user.email, "SCF CREATE Invoice",
     "[scaffold] " + invNo + " · " + eng.client_company + " · Job " + eng.job_no +
     " · RM" + total.toFixed(2)]
  );

  return id; // uuid, same as the plpgsql function
}

// ---- scf_alarms -------------------------------------------------------------
// Port of the Postgres scf_alarms VIEW (CTE + LATERAL) — too complex for a
// portable MySQL view, so it is an RPC returning the same rows/column names:
//   { alarm_type, ref, detail, due_date, recipient }
// Same reminders GAS runDailyReminders() emailed: green tag due/overdue ·
// scaffold collection due · overdue/due-soon invoices · personnel cert expiry.

const EMAIL_RE = /^\S+@\S+\.\S+$/;

async function scf_alarms({ conn }) {
  const cfg = {
    gt_soon:     await settingInt(conn, "GREENTAG_DUE_SOON_DAYS", 2),
    col_soon:    await settingInt(conn, "COLLECTION_DUE_SOON_DAYS", 7),
    inv_soon:    await settingInt(conn, "INVOICE_DUE_SOON_DAYS", 5),
    cert_warn:   await settingInt(conn, "CERT_EXPIRY_WARN_DAYS", 45),
    reminder_to: await setting(conn, "REMINDER_TO"),
    today:       todayMYT(),
  };
  const rows = [];

  // engagement recipient: REMINDER_TO, else handled_by when it is an email
  const engRecipient = (e) =>
    cfg.reminder_to !== "" ? cfg.reminder_to
      : EMAIL_RE.test(e.handled_by || "") ? e.handled_by : "";

  // active/extension jobs + material onsite + last inspection
  const [engs] = await conn.query(
    `SELECT e.*,
            COALESCE((SELECT SUM(GREATEST(m.qty_out - m.qty_returned, 0))
                        FROM scf_materials m WHERE m.engagement_id = e.id), 0) AS material_out,
            (SELECT MAX(i.inspect_date) FROM scf_inspections i
              WHERE i.engagement_id = e.id) AS last_inspection
       FROM scf_engagements e
      WHERE e.status IN ('Active','Extension')`
  );

  for (const e of engs) {
    const site = e.site_name && String(e.site_name) !== "" ? " · " + e.site_name : "";

    // -- green tag inspections due / overdue
    if (e.green_tag === "Yes" || e.service_type === "GreenTag") {
      const base = e.last_inspection || e.start_date || cfg.today;
      const mult = e.last_inspection === null && e.start_date === null ? 0 : 1;
      const due  = addDays(base, (e.inspect_interval_days === null ? 7 : Number(e.inspect_interval_days)) * mult);
      const d    = dayDiff(due, cfg.today);
      if (d <= cfg.gt_soon) {
        rows.push({
          alarm_type: "greentag",
          ref: e.job_no,
          detail: "Green tag " +
            (d < 0 ? "OVERDUE " + (-d) + "d" : d === 0 ? "DUE TODAY" : "due in " + d + "d") +
            " · " + e.client_company + site +
            " · last inspection: " + (e.last_inspection === null ? "none yet" : e.last_inspection) +
            (e.assigned_inspector && String(e.assigned_inspector) !== ""
              ? " · inspector: " + e.assigned_inspector : ""),
          due_date: due,
          recipient: engRecipient(e),
        });
      }
    }

    // -- collection of deployed scaffold material vs rental return date
    const out = num(e.material_out);
    if (out > 0 && e.expected_end_date !== null) {
      const d = dayDiff(e.expected_end_date, cfg.today);
      if (d <= cfg.col_soon) {
        rows.push({
          alarm_type: "collection",
          ref: e.job_no,
          detail: "Collect back " +
            (d < 0 ? "OVERDUE " + (-d) + "d" : d === 0 ? "TODAY" : "in " + d + "d") +
            " · " + e.client_company + site +
            " · " + out + " item(s) onsite" +
            " · return date " + e.expected_end_date,
          due_date: e.expected_end_date,
          recipient: engRecipient(e),
        });
      }
    }
  }

  // -- invoices overdue / due soon (unpaid balance)
  const [invs] = await conn.query(
    `SELECT i.inv_no, i.client_company, i.due_date, i.total,
            (SELECT SUM(p.amount) FROM scf_payments p WHERE p.invoice_id = i.id) AS paid
       FROM scf_invoices i
      WHERE COALESCE(i.status,'') <> 'Void' AND i.due_date IS NOT NULL`
  );
  for (const i of invs) {
    const balance = round2(num(i.total) - num(i.paid));
    const d = dayDiff(i.due_date, cfg.today);
    if (balance > 0.005 && d <= cfg.inv_soon) {
      rows.push({
        alarm_type: "invoice",
        ref: i.inv_no,
        detail: "Invoice " +
          (d < 0 ? "OVERDUE " + (-d) + "d" : d === 0 ? "DUE TODAY" : "due in " + d + "d") +
          " · " + i.client_company +
          " · balance RM " + fmtRM(balance),
        due_date: i.due_date,
        recipient: cfg.reminder_to,
      });
    }
  }

  // -- personnel certification expiry
  const [certs] = await conn.query(
    "SELECT name, cert_type, cert_no, expiry_date FROM scf_personnel WHERE expiry_date IS NOT NULL"
  );
  for (const p of certs) {
    const d = dayDiff(p.expiry_date, cfg.today);
    if (d <= cfg.cert_warn) {
      rows.push({
        alarm_type: "cert",
        ref: p.name,
        detail: p.cert_type +
          (p.cert_no && String(p.cert_no) !== "" ? " " + p.cert_no : "") +
          (d < 0 ? " EXPIRED " + (-d) + "d ago" : " expires in " + d + "d") +
          " (" + p.expiry_date + ") — renew before assigning green tag work",
        due_date: p.expiry_date,
        recipient: cfg.reminder_to,
      });
    }
  }

  // the view had no order; the tool ordered by due_date — keep that here so the
  // cron digest reads the same either way
  rows.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return rows;
}

module.exports = { scf_next_job_no, scf_next_invoice_no, scf_invoice_from_charges, scf_alarms };
