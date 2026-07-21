// Hub Home RPC pack — JS ports of the two biggest plpgsql functions:
//   supabase/schema-executive-home.sql → hub_my_home_mode, hub_executive_home_v1
//   supabase/schema-finance-home.sql   → hub_finance_home_v1
// Contract (see server/rpc.js): each fn gets ({ args, user, conn }) with conn inside
// an OPEN TRANSACTION — use conn.query only; throw to roll back.
//
// Differences vs Supabase, by design (see mysql/modules/15-hub-home.sql):
//   · home_mode lives on `users` (allowed_users is retired) — matched by user.email.
//   · hub_pl_project_financials_v1 (Postgres view) is implemented here as
//     projectFinancials(conn) — one MySQL 8 CTE query, consumed in JS.
//   · scf_alarms has NO MySQL view (module 10 defines none) — every read of it is
//     skipped per-source with the same 'unavailable' fallback the plpgsql
//     exception blocks produced. dsp/wkr/str/trn alarms ARE views (modules 04/13/11/12).

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(v * 100) / 100;
const lower = (v) => String(v == null ? "" : v).toLowerCase();

// to_char(x, 'FM999,999,990.00') — thousands separators, always 2 decimals
const fmt2 = (v) => num(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// to_char(round(x, 0), 'FM999G999G990') — thousands separators, no decimals
const fmt0 = (v) => Math.round(num(v)).toLocaleString("en-US");

// initcap('scaffold') → 'Scaffold'; initcap over words for activity labels
const initcap = (s) => String(s || "").replace(/\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

// Today in Asia/Kuala_Lumpur as YYYY-MM-DD (plpgsql (now() at time zone 'Asia/Kuala_Lumpur')::date)
function klToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}
function asOfDate(p) {
  return typeof p === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : klToday();
}
function addDays(dateStr, days) {
  const t = new Date(dateStr + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}
function monthBounds(asOf) {
  const y = Number(asOf.slice(0, 4)), m = Number(asOf.slice(5, 7));
  const start = asOf.slice(0, 7) + "-01";
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); // first day of next month
  return { start, end };
}
function clampLimit(p) {
  const n = Number(p);
  return Math.max(1, Math.min(Number.isFinite(n) && n > 0 ? Math.floor(n) : 20, 100));
}
// DATE / DATETIME arrive as strings (db.js dateStrings:true). Normalise to
// ISO-comparable YYYY-MM-DD (dates) and ISO timestamps (audit `at`).
const dateStr = (v) => (v ? String(v).slice(0, 10) : null);
const tsStr = (v) => (v ? String(v).replace(" ", "T") : null);

// ─── shared guards ───────────────────────────────────────────────────────────

// hub_my_home_mode() — users.home_mode by session email (allowed_users retired)
async function myHomeMode(conn, user) {
  const [rows] = await conn.query(
    "SELECT home_mode FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1",
    [user.email || ""]
  );
  return rows.length ? rows[0].home_mode : null;
}

// hub_is_executive() gate — raise 42501-equivalent when not executive
async function hubIsExecutive(conn, user) {
  const mode = await myHomeMode(conn, user);
  if (mode !== "executive") throw new Error("Executive Home access required.");
}

// pl_role() — foundation admins are always 'Admin', else pl_user_roles by email, default 'Viewer'
async function plRole(conn, user) {
  if (user.role === "admin") return "Admin";
  const [rows] = await conn.query(
    "SELECT role FROM pl_user_roles WHERE LOWER(email) = LOWER(?) LIMIT 1",
    [user.email || ""]
  );
  return rows.length && ["Admin", "Manager", "Editor", "Viewer"].includes(rows[0].role)
    ? rows[0].role
    : "Viewer";
}

// ─── hub_pl_project_financials_v1 — the per-project financial parity rollup ──
// One row per pl_projects row. Faithful translation of the Postgres view
// (FILTER → SUM(CASE …), booleans → 1/0 coerced below).
async function projectFinancials(conn) {
  const [rows] = await conn.query(`
WITH scope_rows AS (
  SELECT
    s.project_id,
    CASE
      WHEN COALESCE(s.client_amount, 0) = 0
       AND COALESCE(s.qty, 0) = 0
       AND COALESCE(s.client_rate, 0) > 0 THEN COALESCE(s.client_rate, 0)
      ELSE COALESCE(s.client_amount, 0)
    END AS client_value,
    CASE
      WHEN COALESCE(NULLIF(s.performed_by, ''), 'Subcon') <> 'Subcon' THEN 0
      WHEN COALESCE(NULLIF(s.cost_confirmation, ''), 'Confirmed') IN ('Absorbed', 'None') THEN 0
      WHEN COALESCE(s.subcon_amount, 0) = 0
       AND COALESCE(s.qty, 0) = 0
       AND COALESCE(s.subcon_rate, 0) > 0 THEN COALESCE(s.subcon_rate, 0)
      ELSE COALESCE(s.subcon_amount, 0)
    END AS subcon_value,
    CASE
      WHEN COALESCE(NULLIF(s.performed_by, ''), 'Subcon') = 'OtherDivision'
       AND COALESCE(NULLIF(s.cost_confirmation, ''), 'Confirmed') NOT IN ('Absorbed', 'None')
        THEN COALESCE(s.internal_cost, 0)
      ELSE 0
    END AS internal_value,
    CASE WHEN COALESCE(NULLIF(s.cost_confirmation, ''), 'Confirmed') = 'Estimated' THEN 1 ELSE 0 END AS estimated_count,
    CASE
      WHEN COALESCE(NULLIF(s.cost_confirmation, ''), 'Confirmed') <> 'Estimated' THEN 0
      WHEN COALESCE(NULLIF(s.performed_by, ''), 'Subcon') = 'OtherDivision' THEN COALESCE(s.internal_cost, 0)
      WHEN COALESCE(NULLIF(s.performed_by, ''), 'Subcon') = 'Subcon' THEN
        CASE
          WHEN COALESCE(s.subcon_amount, 0) = 0
           AND COALESCE(s.qty, 0) = 0
           AND COALESCE(s.subcon_rate, 0) > 0 THEN COALESCE(s.subcon_rate, 0)
          ELSE COALESCE(s.subcon_amount, 0)
        END
      ELSE 0
    END AS estimated_value
  FROM pl_job_scopes s
),
scope_totals AS (
  SELECT project_id,
    COALESCE(SUM(client_value), 0)    AS subtotal,
    COALESCE(SUM(subcon_value), 0)    AS scope_subcon,
    COALESCE(SUM(internal_value), 0)  AS internal_cost,
    COALESCE(SUM(estimated_count), 0) AS estimated_scope_count,
    COALESCE(SUM(estimated_value), 0) AS estimated_cost
  FROM scope_rows GROUP BY project_id
),
material_totals AS (
  SELECT project_id,
    COALESCE(SUM(CASE WHEN COALESCE(material_source, 'Supplier') <> 'InHouseSubcon' THEN total_cost ELSE 0 END), 0) AS supplier_material_cost,
    COALESCE(SUM(CASE WHEN material_source = 'InHouseSubcon' THEN total_cost ELSE 0 END), 0) AS inhouse_deduction
  FROM pl_materials GROUP BY project_id
),
charge_totals AS (
  SELECT project_id, COALESCE(SUM(lump_amount), 0) AS lump_subcon
  FROM pl_subcon_charges GROUP BY project_id
),
manpower_totals AS (
  SELECT project_id, COALESCE(SUM(total_cost), 0) AS manpower_cost
  FROM pl_manpower GROUP BY project_id
),
client_paid AS (
  SELECT project_id, COALESCE(SUM(amount), 0) AS received
  FROM pl_client_payments GROUP BY project_id
),
subcon_paid AS (
  SELECT project_id, COALESCE(SUM(amount), 0) AS paid_subcon
  FROM pl_subcon_payments GROUP BY project_id
),
supplier_paid AS (
  SELECT project_id, COALESCE(SUM(amount), 0) AS paid_supplier
  FROM pl_supplier_payments GROUP BY project_id
),
credit_totals AS (
  SELECT project_id,
    ROUND(COALESCE(SUM(CASE WHEN type IN ('credit', 'refund') THEN amount ELSE 0 END), 0), 2) AS credits_refunds
  FROM pl_credit_notes GROUP BY project_id
),
base AS (
  SELECT
    p.id, p.code, p.client_name, p.status,
    p.invoice_date, p.invoice_number, p.invoice_amount,
    p.discount, p.adjustment, p.sst_applicable, p.sst_rate,
    COALESCE(st.subtotal, 0)               AS subtotal,
    COALESCE(st.scope_subcon, 0)           AS scope_subcon,
    COALESCE(st.internal_cost, 0)          AS internal_cost,
    COALESCE(st.estimated_scope_count, 0)  AS estimated_scope_count,
    COALESCE(st.estimated_cost, 0)         AS estimated_cost,
    COALESCE(mt.supplier_material_cost, 0) AS supplier_material_cost,
    COALESCE(mt.inhouse_deduction, 0)      AS inhouse_deduction,
    COALESCE(ct.lump_subcon, 0)            AS lump_subcon,
    COALESCE(mpt.manpower_cost, 0)         AS manpower_cost,
    COALESCE(cp.received, 0)               AS received,
    COALESCE(sp.paid_subcon, 0)            AS paid_subcon,
    COALESCE(spp.paid_supplier, 0)         AS paid_supplier,
    COALESCE(cr.credits_refunds, 0)        AS credits_refunds
  FROM pl_projects p
  LEFT JOIN scope_totals st    ON st.project_id  = p.id
  LEFT JOIN material_totals mt ON mt.project_id  = p.id
  LEFT JOIN charge_totals ct   ON ct.project_id  = p.id
  LEFT JOIN manpower_totals mpt ON mpt.project_id = p.id
  LEFT JOIN client_paid cp     ON cp.project_id  = p.id
  LEFT JOIN subcon_paid sp     ON sp.project_id  = p.id
  LEFT JOIN supplier_paid spp  ON spp.project_id = p.id
  LEFT JOIN credit_totals cr   ON cr.project_id  = p.id
),
invoice_calc AS (
  SELECT b.*,
    b.subtotal - COALESCE(b.discount, 0) + COALESCE(b.adjustment, 0) AS after_adjustment,
    CASE WHEN COALESCE(b.sst_applicable, 0) = 1
      THEN ROUND((b.subtotal - COALESCE(b.discount, 0) + COALESCE(b.adjustment, 0))
        * COALESCE(NULLIF(b.sst_rate, 0), 6) / 100, 2)
      ELSE 0 END AS sst_amount,
    ROUND(b.scope_subcon + b.lump_subcon - b.inhouse_deduction, 2) AS subcon_committed
  FROM base b
),
money AS (
  SELECT i.*,
    ROUND(i.after_adjustment + i.sst_amount, 2) AS computed_total,
    COALESCE(NULLIF(i.invoice_amount, 0), NULLIF(ROUND(i.after_adjustment + i.sst_amount, 2), 0), i.subtotal) AS invoiced_gross,
    (i.invoice_date IS NOT NULL OR COALESCE(TRIM(i.invoice_number), '') <> '' OR COALESCE(i.invoice_amount, 0) <> 0) AS invoice_evidence,
    (COALESCE(i.invoice_amount, 0) = 0) AS used_computed_invoice
  FROM invoice_calc i
),
final_values AS (
  SELECT m.*,
    ROUND(m.invoiced_gross - m.credits_refunds, 2) AS invoiced,
    ROUND(m.invoiced_gross - m.credits_refunds - m.sst_amount, 2) AS net_revenue,
    m.subcon_committed + m.supplier_material_cost + m.manpower_cost + m.internal_cost AS total_cost
  FROM money m
)
SELECT
  f.id, f.code, f.client_name, f.status, f.invoice_date, f.invoice_number,
  f.invoice_evidence, f.used_computed_invoice,
  ROUND(f.subtotal, 2) AS subtotal,
  f.sst_amount, f.invoiced, f.net_revenue, f.received,
  f.invoiced - f.received AS client_outstanding,
  f.subcon_committed, f.supplier_material_cost,
  f.manpower_cost, f.internal_cost,
  f.total_cost, f.net_revenue - f.total_cost AS profit,
  CASE WHEN f.net_revenue > 0 THEN (f.net_revenue - f.total_cost) / f.net_revenue * 100 ELSE 0 END AS margin,
  f.estimated_cost, f.estimated_scope_count,
  f.subcon_committed - f.paid_subcon AS subcontractor_outstanding,
  f.supplier_material_cost - f.paid_supplier AS supplier_outstanding
FROM final_values f`);

  // DECIMALs come back as strings — coerce once, keep the view's column names
  return rows.map((r) => ({
    id: String(r.id),
    code: r.code == null ? "" : String(r.code),
    client_name: r.client_name == null ? "" : String(r.client_name),
    status: r.status == null ? "" : String(r.status),
    invoice_date: dateStr(r.invoice_date),
    invoice_number: r.invoice_number == null ? "" : String(r.invoice_number),
    invoice_evidence: Number(r.invoice_evidence) === 1,
    used_computed_invoice: Number(r.used_computed_invoice) === 1,
    subtotal: num(r.subtotal),
    sst_amount: num(r.sst_amount),
    invoiced: num(r.invoiced),
    net_revenue: num(r.net_revenue),
    received: num(r.received),
    client_outstanding: num(r.client_outstanding),
    subcon_committed: num(r.subcon_committed),
    supplier_material_cost: num(r.supplier_material_cost),
    manpower_cost: num(r.manpower_cost),
    internal_cost: num(r.internal_cost),
    total_cost: num(r.total_cost),
    profit: num(r.profit),
    margin: num(r.margin),
    estimated_cost: num(r.estimated_cost),
    estimated_scope_count: num(r.estimated_scope_count),
    subcontractor_outstanding: num(r.subcontractor_outstanding),
    supplier_outstanding: num(r.supplier_outstanding)
  }));
}

// ─── attention ranking (identical ORDER BY in both plpgsql functions) ────────
// severity critical→warning→watch, due_date asc NULLS LAST, amount desc, item_key asc
const sevRank = (s) => (s === "critical" ? 1 : s === "warning" ? 2 : 3);
function sortItems(items) {
  return items.slice().sort((a, b) => {
    const sr = sevRank(a.severity) - sevRank(b.severity);
    if (sr) return sr;
    const ad = a.due_date || null, bd = b.due_date || null;
    if (ad !== bd) {
      if (ad == null) return 1;
      if (bd == null) return -1;
      if (ad < bd) return -1;
      if (ad > bd) return 1;
    }
    const am = num(a.amount), bm = num(b.amount);
    if (am !== bm) return bm - am;
    return String(a.item_key) < String(b.item_key) ? -1 : String(a.item_key) > String(b.item_key) ? 1 : 0;
  });
}

module.exports = {

  // ─── hub_my_home_mode() → 'operations' | 'executive' | null ────────────────
  hub_my_home_mode: async ({ user, conn }) => {
    return myHomeMode(conn, user);
  },

  // ─── hub_executive_home_v1(p_as_of, p_attention_limit) → jsonb summary ─────
  hub_executive_home_v1: async ({ args, user, conn }) => {
    await hubIsExecutive(conn, user);

    const asOf = asOfDate(args.p_as_of);
    const { start: monthStart, end: monthEnd } = monthBounds(asOf);
    const limit = clampLimit(args.p_attention_limit);
    const financeRole = await plRole(conn, user);

    let snapshot = {};
    const execution = {};
    const items = [];
    let activity = [];
    const quality = [];
    const unavailable = [];

    // Quotations
    try {
      const [q] = await conn.query(
        "SELECT COALESCE(SUM(total), 0) AS value, COUNT(*) AS cnt FROM quotes WHERE status IN ('Draft', 'Sent')"
      );
      const cnt = num(q[0].cnt);
      snapshot.open_quotations = {
        value: num(q[0].value), count: cnt, unit: "MYR",
        status: cnt === 0 ? "clear" : "watch",
        basis: "Draft and sent", source: "quotes"
      };
    } catch (e) {
      snapshot.open_quotations = { value: null, status: "unavailable" };
      unavailable.push({ source: "quotes", message: e.message });
    }

    // Project financials (Project P&L money permission required)
    const finUnavailable = () => {
      snapshot.active_projects = { value: null, status: "unavailable" };
      snapshot.net_revenue_mtd = { value: null, status: "unavailable" };
      snapshot.client_outstanding = { value: null, status: "unavailable" };
      snapshot.profit_mtd = { value: null, status: "unavailable" };
    };
    if (financeRole === "Admin" || financeRole === "Manager") {
      try {
        const fin = await projectFinancials(conn);
        const mtd = fin.filter((r) => r.invoice_date && r.invoice_date >= monthStart && r.invoice_date < monthEnd);
        const outstandingRows = fin.filter((r) => r.invoice_evidence && lower(r.status) !== "cancelled");
        const outstandingPos = outstandingRows.filter((r) => r.client_outstanding > 0);
        const revMtd = mtd.reduce((s, r) => s + r.net_revenue, 0);
        const profitMtd = mtd.reduce((s, r) => s + r.profit, 0);

        snapshot.active_projects = {
          value: fin.filter((r) => lower(r.status) === "active").length, unit: "count",
          status: "clear", basis: "Project P&L", source: "hub_pl_project_financials_v1"
        };
        snapshot.net_revenue_mtd = {
          value: revMtd, unit: "MYR", status: "clear",
          basis: "Invoice-date cohort · ex-SST", source: "hub_pl_project_financials_v1"
        };
        snapshot.client_outstanding = {
          value: outstandingRows.reduce((s, r) => s + Math.max(r.client_outstanding, 0), 0),
          count: outstandingPos.length, unit: "MYR",
          status: outstandingPos.length === 0 ? "clear" : "watch",
          basis: "All invoiced tracked projects", source: "hub_pl_project_financials_v1"
        };
        snapshot.profit_mtd = {
          value: profitMtd,
          margin: revMtd > 0 ? round2(profitMtd / revMtd * 100) : 0,
          unit: "MYR", status: profitMtd < 0 ? "critical" : "clear",
          basis: "Projects invoiced this month · full project-to-date cost",
          source: "hub_pl_project_financials_v1"
        };

        // Data-quality flags
        for (const r of fin) {
          if (r.invoice_evidence && r.used_computed_invoice)
            quality.push({ code: r.code, message: "Computed invoice fallback used", project_id: r.id });
        }
        for (const r of fin) {
          if (r.invoice_evidence && r.invoice_date == null)
            quality.push({ code: r.code, message: "Invoice date missing", project_id: r.id });
        }

        // Loss-making active projects → critical attention items
        for (const r of fin) {
          if (lower(r.status) === "active" && r.net_revenue > 0 && r.profit < 0) {
            items.push({
              item_key: "finance:loss:" + r.id,
              domain: "finance", severity: "critical", type: "negative_project_profit",
              title: (r.code || r.client_name || "Project") + " is below cost",
              detail: "Project profit " + fmt2(r.profit),
              owner: null, due_date: r.invoice_date, amount: Math.abs(r.profit),
              source: "hub_pl_project_financials_v1", source_ref: r.id,
              tool_id: "Project Revenue vs Expenses (P&L)", tool_tab: null,
              action_label: "Open Project P&L"
            });
          }
        }
      } catch (e) {
        finUnavailable();
        unavailable.push({ source: "project_pl", message: e.message });
      }
    } else {
      finUnavailable();
      unavailable.push({ source: "project_pl", message: "Project P&L Admin or Manager required" });
    }

    // Dispatch execution and attention — now the REAL schedule: ja_jobs + ja_job_readiness
    // (dsp_jobs/dsp_alarms retired; same gate rules as the shared hg-readiness.js)
    try {
      const hgReadiness = require("../public/hg-readiness.js");
      const [upcoming] = await conn.query(
        `SELECT j.id, j.mall, j.lot, j.date, j.scope,
                r.measure_status, r.quote_status, r.needs_visual, r.visual_status,
                r.permit_by, r.permit_status, r.material_ready, r.job_id AS has_readiness
           FROM ja_jobs j
           LEFT JOIN ja_job_readiness r ON r.job_id = j.id
          WHERE j.date >= CURDATE() AND j.date <= DATE_ADD(CURDATE(), INTERVAL 14 DAY)`);
      const counts = { active: upcoming.length, permit_alarms: 0, at_risk: 0, blocked: 0, ready: 0 };
      for (const row of upcoming) {
        const verdict = hgReadiness.of({ mall: row.mall, lot: row.lot, date: row.date },
          row.has_readiness ? row : null);
        if (verdict.permitAlarm) counts.permit_alarms++;
        if (verdict.status === "at_risk") counts.at_risk++;
        else if (verdict.status === "blocked") counts.blocked++;
        else if (verdict.status === "ready") counts.ready++;
        if (verdict.status === "blocked" || verdict.permitAlarm) {
          const due = dateStr(row.date);
          const ref = (row.mall || "Job") + (row.lot ? " — " + row.lot : "");
          const kind = verdict.permitAlarm ? "permit_alarm" : "blocked";
          items.push({
            item_key: "dispatch:" + kind + ":" + row.id,
            domain: "dispatch",
            severity: (due && due <= asOf) ? "critical" : "warning",
            type: kind, title: ref,
            detail: (verdict.permitAlarm ? "Permit not ready — " : "Not ready — ") +
                    "missing: " + verdict.missing.join(", "),
            owner: null, due_date: due, amount: null, source: "ja_job_readiness",
            source_ref: ref, tool_id: "Daily Readiness & Dispatch", tool_tab: null,
            action_label: "Open dispatch"
          });
        }
      }
      execution.dispatch = counts;
    } catch (e) {
      unavailable.push({ source: "dispatch", message: e.message });
    }

    // Workforce execution and attention
    try {
      const [alarms] = await conn.query("SELECT alarm_type, ref, detail, due_date FROM wkr_alarms");
      const in7 = addDays(asOf, 7), in30 = addDays(asOf, 30);
      const dued = alarms.map((a) => ({ ...a, due: dateStr(a.due_date) }));
      execution.workforce = {
        expired: dued.filter((a) => a.due && a.due < asOf).length,
        due_7_days: dued.filter((a) => a.due && a.due >= asOf && a.due <= in7).length,
        due_30_days: dued.filter((a) => a.due && a.due > in7 && a.due <= in30).length
      };
      for (const a of dued) {
        items.push({
          item_key: "workforce:" + lower(a.alarm_type) + ":" + (a.ref || "") + ":" + (a.due || ""),
          domain: "workforce",
          severity: a.due && a.due < asOf ? "critical" : a.due && a.due <= in7 ? "warning" : "watch",
          type: lower(a.alarm_type), title: a.ref || "Worker document", detail: a.detail,
          owner: null, due_date: a.due, amount: null, source: "wkr_alarms",
          source_ref: a.ref, tool_id: "Workers Documentation & Permits", tool_tab: null,
          action_label: "Open worker docs"
        });
      }
    } catch (e) {
      unavailable.push({ source: "workforce", message: e.message });
    }

    // Scaffold + storage attention.
    // scf_alarms has no MySQL view — fetched per-source so storage still renders
    // when scaffold is unavailable (Postgres combined both in one block).
    {
      const combined = [];
      let anySource = false;
      try {
        const [rows] = await conn.query("SELECT alarm_type, ref, detail, due_date FROM scf_alarms");
        rows.forEach((r) => combined.push({ source: "scaffold", ...r }));
        anySource = true;
      } catch (e) {
        unavailable.push({ source: "scaffold", message: e.message });
      }
      try {
        const [rows] = await conn.query("SELECT alarm_type, ref, detail, due_date FROM str_alarms");
        rows.forEach((r) => combined.push({ source: "storage", ...r }));
        anySource = true;
      } catch (e) {
        unavailable.push({ source: "storage", message: e.message });
      }
      if (anySource) {
        const isOverdueType = (t) => /overdue|expired/i.test(String(t || ""));
        const rows = combined.map((r) => ({ ...r, due: dateStr(r.due_date) }));
        execution.scaffold_storage = {
          scaffold_overdue: rows.filter((r) => r.source === "scaffold" && r.due && r.due < asOf).length,
          scaffold_due: rows.filter((r) => r.source === "scaffold" && r.due && r.due >= asOf).length,
          storage_overdue: rows.filter((r) => r.source === "storage" && ((r.due && r.due < asOf) || isOverdueType(r.alarm_type))).length,
          storage_due: rows.filter((r) => r.source === "storage" && r.due && r.due >= asOf).length
        };
        for (const r of rows) {
          items.push({
            item_key: r.source + ":" + lower(r.alarm_type) + ":" + (r.ref || "") + ":" + (r.due || ""),
            domain: r.source,
            severity: ((r.due && r.due < asOf) || isOverdueType(r.alarm_type)) ? "critical"
              : (r.due && r.due <= asOf) ? "warning" : "watch",
            type: lower(r.alarm_type),
            title: r.ref || initcap(r.source) + " decision", detail: r.detail,
            owner: null, due_date: r.due, amount: null, source: r.source + "_alarms",
            source_ref: r.ref,
            tool_id: r.source === "scaffold" ? "Scaffold & Green Tag System" : "Inventory, Tools & Purchasing",
            tool_tab: null,
            action_label: r.source === "scaffold" ? "Open scaffold" : "Open inventory"
          });
        }
      }
    }

    // Inventory on-hand (purchases − deliveries vs low-stock threshold)
    try {
      const [stock] = await conn.query(`
        SELECT m.id, m.name, m.low_stock_threshold,
               COALESCE(p.qty, 0) - COALESCE(d.qty, 0) AS on_hand
        FROM inv_materials m
        LEFT JOIN (SELECT material_id, COALESCE(SUM(qty), 0) AS qty FROM inv_purchase_lines
                   WHERE item_type = 'material' GROUP BY material_id) p ON p.material_id = m.id
        LEFT JOIN (SELECT material_id, COALESCE(SUM(qty), 0) AS qty FROM inv_stock_out_lines
                   GROUP BY material_id) d ON d.material_id = m.id`);
      const typed = stock.map((r) => ({
        id: String(r.id), name: String(r.name || ""),
        threshold: num(r.low_stock_threshold), onHand: num(r.on_hand)
      }));
      execution.inventory = {
        low_stock: typed.filter((r) => r.onHand <= r.threshold).length,
        critical: typed.filter((r) => r.onHand <= 0).length,
        warning: typed.filter((r) => r.onHand > 0 && r.onHand <= r.threshold).length
      };
      for (const r of typed) {
        if (r.onHand <= r.threshold) {
          items.push({
            item_key: "inventory:stock:" + r.id, domain: "inventory",
            severity: r.onHand <= 0 ? "critical" : "warning", type: "low_stock",
            title: r.name + " needs stock review",
            detail: "On hand " + r.onHand + " · threshold " + r.threshold,
            owner: null, due_date: null, amount: null,
            source: "inv_materials", source_ref: r.id,
            tool_id: "Inventory, Tools & Purchasing", tool_tab: null,
            action_label: "Open inventory"
          });
        }
      }
    } catch (e) {
      unavailable.push({ source: "inventory", message: e.message });
    }

    // Shared executive activity — last 25 audit rows mapped to tool names
    try {
      const [rows] = await conn.query(
        "SELECT at, user_email, action, details FROM audit_log ORDER BY at DESC LIMIT 25"
      );
      activity = rows.map((r) => {
        const action = String(r.action || "");
        const a = action.toLowerCase();
        let toolId = null;
        if (a.startsWith("dsp.") || a.includes("dispatch")) toolId = "Daily Readiness & Dispatch";
        else if (a.startsWith("wkr.") || a.includes("worker") || a.includes("permit")) toolId = "Workers Documentation & Permits";
        else if (a.startsWith("scf.") || a.includes("scaffold") || /green.*tag/.test(a)) toolId = "Scaffold & Green Tag System";
        else if (a.startsWith("inv.") || a.includes("inventory") || a.includes("stock")) toolId = "Inventory, Tools & Purchasing";
        else if (a.startsWith("pl.") || /project.*p&l/.test(a)) toolId = "Project Revenue vs Expenses (P&L)";
        else if (a.includes("quote")) toolId = "Smart Quotation";
        else if (a.includes("site")) toolId = "Daily Site Tracking";
        else if (a.includes("completion")) toolId = "Job Completion Report";
        return {
          at: tsStr(r.at), actor: r.user_email, action_code: action,
          action_label: initcap(action.replace(/_/g, " ").replace(/\./g, " ")),
          detail: r.details, domain: action.split(".")[0],
          tool_id: toolId
        };
      });
    } catch (e) {
      unavailable.push({ source: "audit_log", message: e.message });
    }

    const sorted = sortItems(items);
    const attention = {
      total: items.length,
      critical: items.filter((i) => i.severity === "critical").length,
      warning: items.filter((i) => i.severity === "warning").length,
      watch: items.filter((i) => i.severity === "watch").length,
      items: sorted.slice(0, limit)
    };

    snapshot = {
      urgent_exceptions: {
        value: attention.critical, unit: "count",
        status: attention.critical > 0 ? "critical" : "clear",
        basis: "As of " + asOf, source: "executive_attention"
      },
      ...snapshot
    };

    return {
      version: "executive-home-v1", as_of: asOf, timezone: "Asia/Kuala_Lumpur",
      generated_at: new Date().toISOString(),
      role: { home_mode: "executive", finance_role: financeRole },
      snapshot, execution, attention,
      activity, data_quality: quality, unavailable
    };
  },

  // ─── hub_finance_home_v1(p_as_of, p_attention_limit) → jsonb summary ───────
  hub_finance_home_v1: async ({ args, user, conn }) => {
    const role = await plRole(conn, user);
    if (role !== "Admin" && role !== "Manager")
      throw new Error("Project P&L Admin or Manager access required.");

    const asOf = asOfDate(args.p_as_of);
    const { start: monthStart, end: monthEnd } = monthBounds(asOf);
    const limit = clampLimit(args.p_attention_limit);

    let snapshot = {};
    const queues = {};
    const items = [];
    let activity = [];
    const unavailable = [];

    // Portfolio financial position (portfolio totals, not MTD) + P&L attention.
    // fin is reused by the receivables/payables queues below when available.
    let fin = null;
    try {
      fin = await projectFinancials(conn);
      const live = fin.filter((r) => lower(r.status) !== "cancelled");
      const invoiced = live.filter((r) => r.invoice_evidence);
      const netRevenue = live.reduce((s, r) => s + r.net_revenue, 0);
      const profit = live.reduce((s, r) => s + r.profit, 0);

      snapshot = {
        client_outstanding: {
          value: invoiced.reduce((s, r) => s + Math.max(r.client_outstanding, 0), 0),
          count: invoiced.filter((r) => r.client_outstanding > 0).length,
          unit: "MYR", source: "hub_pl_project_financials_v1"
        },
        subcontractor_outstanding: {
          value: live.reduce((s, r) => s + Math.max(r.subcontractor_outstanding, 0), 0),
          count: live.filter((r) => r.subcontractor_outstanding > 0).length,
          unit: "MYR", source: "hub_pl_project_financials_v1"
        },
        supplier_outstanding: {
          value: live.reduce((s, r) => s + Math.max(r.supplier_outstanding, 0), 0),
          count: live.filter((r) => r.supplier_outstanding > 0).length,
          unit: "MYR", source: "hub_pl_project_financials_v1"
        },
        net_revenue: { value: netRevenue, unit: "MYR", source: "hub_pl_project_financials_v1" },
        project_profit: { value: profit, unit: "MYR", source: "hub_pl_project_financials_v1" },
        average_margin: {
          value: netRevenue > 0 ? round2(profit / netRevenue * 100) : 0,
          unit: "percent", source: "hub_pl_project_financials_v1"
        }
      };

      // Loss-making active projects → critical
      for (const r of fin) {
        if (lower(r.status) === "active" && r.net_revenue > 0 && r.profit < 0) {
          items.push({
            item_key: "finance:loss:" + r.id,
            domain: "finance", severity: "critical", type: "negative_project_profit",
            title: (r.code || r.client_name || "Project") + " is below cost",
            detail: "Current project profit is RM " + fmt2(round2(r.profit)) + ".",
            impact: "RM " + fmt0(r.profit < 0 ? -r.profit : r.profit),
            due_date: r.invoice_date, amount: Math.abs(r.profit),
            tool_id: "Project Revenue vs Expenses (P&L)", action_label: "Review Project P&L"
          });
        }
      }
      // Estimated-cost projects → warning
      for (const r of fin) {
        if (lower(r.status) !== "cancelled" && r.estimated_scope_count > 0) {
          items.push({
            item_key: "finance:estimated:" + r.id,
            domain: "finance", severity: "warning", type: "estimated_project_cost",
            title: (r.code || r.client_name || "Project") + " has estimated costs to confirm",
            detail: r.estimated_scope_count + " project scope" +
              (r.estimated_scope_count === 1 ? "" : "s") + " still use estimated cost.",
            impact: "RM " + fmt0(r.estimated_cost),
            due_date: null, amount: r.estimated_cost,
            tool_id: "Project Revenue vs Expenses (P&L)", action_label: "Review Project P&L"
          });
        }
      }
    } catch (e) {
      fin = null;
      unavailable.push({ source: "project_pl", message: e.message });
    }

    // Real due-date exceptions from operational billing tools — per source so
    // storage/transport still render when scf_alarms (no MySQL view) is missing.
    {
      const invoiceAlarms = [];
      try {
        const [rows] = await conn.query(
          "SELECT alarm_type, ref, detail, due_date FROM scf_alarms WHERE LOWER(alarm_type) = 'invoice'"
        );
        rows.forEach((r) => invoiceAlarms.push({
          source: "scaffold", ...r,
          tool_id: "Scaffold & Green Tag System", action_label: "Open scaffold invoices"
        }));
      } catch (e) {
        unavailable.push({ source: "scaffold_billing", message: e.message });
      }
      try {
        const [rows] = await conn.query(
          "SELECT alarm_type, ref, detail, due_date FROM str_alarms WHERE UPPER(alarm_type) IN ('INVOICE_OVERDUE', 'INVOICE_DUE')"
        );
        rows.forEach((r) => invoiceAlarms.push({
          source: "storage", ...r,
          tool_id: "Temporary Storage Rental", action_label: "Open storage invoices"
        }));
      } catch (e) {
        unavailable.push({ source: "storage_billing", message: e.message });
      }
      try {
        const [rows] = await conn.query(
          "SELECT alarm_type, ref, detail, due_date FROM trn_alarms WHERE UPPER(alarm_type) = 'INVOICE_OVERDUE'"
        );
        rows.forEach((r) => invoiceAlarms.push({
          source: "transport", ...r,
          tool_id: "Transport / Mover / Rorobin", action_label: "Open transport invoices"
        }));
      } catch (e) {
        unavailable.push({ source: "transport_billing", message: e.message });
      }
      for (const a of invoiceAlarms) {
        const due = dateStr(a.due_date);
        items.push({
          item_key: a.source + ":" + lower(a.alarm_type) + ":" + (a.ref || "") + ":" + (due || ""),
          domain: "finance",
          severity: due && due < asOf ? "critical" : "warning",
          type: lower(a.alarm_type), title: a.ref, detail: a.detail,
          impact: due && due < asOf ? "Overdue" : "Due soon",
          due_date: due, amount: null,
          tool_id: a.tool_id, action_label: a.action_label
        });
      }
    }

    // Work queues — receivables (project balances + overdue operational invoices)
    try {
      const invoiced = fin
        ? fin.filter((r) => r.invoice_evidence && lower(r.status) !== "cancelled")
        : null;
      if (!invoiced) throw new Error("Project financial rollup unavailable");
      const [overdue] = await conn.query(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(balance), 0) AS amount FROM (
           SELECT GREATEST(i.total - COALESCE(p.paid, 0), 0) AS balance
           FROM scf_invoices i
           LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM scf_payments GROUP BY invoice_id) p
                  ON p.invoice_id = i.id
           WHERE COALESCE(i.status, '') <> 'Void' AND i.due_date < ?
             AND i.total - COALESCE(p.paid, 0) > 0.005
           UNION ALL
           SELECT GREATEST(i.total - COALESCE(p.paid, 0), 0)
           FROM str_invoices i
           LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM str_payments GROUP BY invoice_id) p
                  ON p.invoice_id = i.id
           WHERE COALESCE(i.status, '') <> 'Void' AND i.due_date < ?
             AND i.total - COALESCE(p.paid, 0) > 0.005
           UNION ALL
           SELECT GREATEST(i.total - COALESCE(p.paid, 0), 0)
           FROM trn_invoices i
           LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM trn_payments GROUP BY invoice_id) p
                  ON p.invoice_id = i.id
           WHERE COALESCE(i.status, '') <> 'Void' AND COALESCE(i.due_date, '') <> ''
             AND STR_TO_DATE(i.due_date, '%Y-%m-%d') < ?
             AND i.total - COALESCE(p.paid, 0) > 0.005
         ) overdue_rows`,
        [asOf, asOf, asOf]
      );
      queues.receivables = {
        project_count: invoiced.filter((r) => r.client_outstanding > 0).length,
        project_amount: invoiced.reduce((s, r) => s + Math.max(r.client_outstanding, 0), 0),
        overdue_count: num(overdue[0].cnt),
        overdue_amount: num(overdue[0].amount)
      };
    } catch (e) {
      unavailable.push({ source: "receivables", message: e.message });
    }

    // Payables (project subcon / supplier outstanding)
    try {
      if (!fin) throw new Error("Project financial rollup unavailable");
      const live = fin.filter((r) => lower(r.status) !== "cancelled");
      queues.payables = {
        subcontractor_count: live.filter((r) => r.subcontractor_outstanding > 0).length,
        subcontractor_amount: live.reduce((s, r) => s + Math.max(r.subcontractor_outstanding, 0), 0),
        supplier_count: live.filter((r) => r.supplier_outstanding > 0).length,
        supplier_amount: live.reduce((s, r) => s + Math.max(r.supplier_outstanding, 0), 0)
      };
    } catch (e) {
      unavailable.push({ source: "payables", message: e.message });
    }

    // Claims + business expenses (records, not approval queues)
    try {
      const [[claims], [expenses]] = await Promise.all([
        conn.query(
          "SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS amount FROM clm_claims WHERE status = 'submitted'"
        ),
        conn.query(
          "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS amount FROM exp_expenses WHERE type = 'business' AND receipt_date >= ? AND receipt_date < ?",
          [monthStart, monthEnd]
        )
      ]);
      queues.claims_expenses = {
        claims_count: num(claims[0].cnt), claims_amount: num(claims[0].amount),
        expense_count: num(expenses[0].cnt), expense_amount: num(expenses[0].amount)
      };
    } catch (e) {
      unavailable.push({ source: "claims_expenses", message: e.message });
    }

    // Invoice production (subcon invoices MTD + open quotations)
    try {
      const [[sci], [quotes]] = await Promise.all([
        conn.query(
          "SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS amount FROM sci_invoices WHERE inv_date >= ? AND inv_date < ?",
          [monthStart, monthEnd]
        ),
        conn.query(
          "SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS amount FROM quotes WHERE status IN ('Draft', 'Sent')"
        )
      ]);
      queues.invoice_production = {
        subcon_invoice_count: num(sci[0].cnt), subcon_invoice_amount: num(sci[0].amount),
        open_quote_count: num(quotes[0].cnt), open_quote_amount: num(quotes[0].amount)
      };
    } catch (e) {
      unavailable.push({ source: "invoice_production", message: e.message });
    }

    // Finance-filtered activity feed (last 20). LIKE under utf8mb4_unicode_ci is
    // case-insensitive, matching Postgres ILIKE.
    try {
      const [rows] = await conn.query(
        `SELECT at, user_email, action, details FROM audit_log
         WHERE action LIKE '[P&L]%'
            OR action LIKE 'claim.%'
            OR action LIKE 'summary.%'
            OR action LIKE 'EXP %'
            OR action LIKE 'invoice.%'
            OR action LIKE 'SCF %'
            OR action IN ('CREATE Invoice', 'UPDATE Invoice', 'AUTO_INVOICE')
         ORDER BY at DESC LIMIT 20`
      );
      activity = rows.map((r) => {
        const action = String(r.action || "");
        const a = action.toLowerCase();
        let toolId = null;
        if (a.startsWith("[p&l]")) toolId = "Project Revenue vs Expenses (P&L)";
        else if (a.startsWith("claim.") || a.startsWith("summary.")) toolId = "Receipt Claims";
        else if (a.startsWith("exp ")) toolId = "Expenses Receipt System";
        else if (a.startsWith("invoice.")) toolId = "Subcon Invoice Generator";
        else if (a.startsWith("scf ")) toolId = "Scaffold & Green Tag System";
        return {
          at: tsStr(r.at), actor: r.user_email, action_code: action,
          detail: r.details, domain: "finance", tool_id: toolId
        };
      });
    } catch (e) {
      unavailable.push({ source: "audit_log", message: e.message });
    }

    const sorted = sortItems(items);
    const attention = {
      total: items.length,
      critical: items.filter((i) => i.severity === "critical").length,
      warning: items.filter((i) => i.severity === "warning").length,
      items: sorted.slice(0, limit)
    };

    return {
      version: "finance-home-v1", as_of: asOf, timezone: "Asia/Kuala_Lumpur",
      generated_at: new Date().toISOString(),
      role: { home_mode: "finance", finance_role: role, can_manage_users: role === "Admin" },
      snapshot, attention, queues, activity, unavailable
    };
  }
};
