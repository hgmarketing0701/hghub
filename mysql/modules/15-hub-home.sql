-- ============================================================
-- HG hub — hub home (Executive + Finance dashboards) (MySQL 8)
-- Translated from supabase/schema-executive-home.sql + supabase/schema-finance-home.sql
-- Reconciled against mysql/xlsx-headers.md (2026-07-16) — no matching tabs;
-- these schemas define no data tables of their own (functions/views only).
-- ============================================================
SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- 1. users.home_mode  (durable Home persona assignment)
--    allowed_users was RETIRED in the cPanel migration — auth now lives in the
--    `users` table (foundation module). home_mode attaches there instead.
--    MySQL 8 has no ADD COLUMN IF NOT EXISTS, so guard via information_schema
--    to keep this file safe to re-run.
-- ------------------------------------------------------------
SET @stmt = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN home_mode VARCHAR(32) NOT NULL DEFAULT ''operations'' CHECK (home_mode IN (''operations'', ''executive''))',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND column_name = 'home_mode'
);
PREPARE add_home_mode FROM @stmt;
EXECUTE add_home_mode;
DEALLOCATE PREPARE add_home_mode;

-- Bootstrap: the two executives (no-op until those users are created).
UPDATE users
SET home_mode = 'executive'
WHERE LOWER(email) IN ('lee@hggroup.com.my', 'marketing@hggroup.com.my');

-- NOTE (Phase 2 / API): in Supabase, INSERT/UPDATE grants on allowed_users
-- excluded home_mode so generic team-access screens could NOT assign or change
-- a Home persona. The Express API must enforce the same rule: home_mode is
-- writable only through an admin-only endpoint (users is already deny-listed
-- in server/rules.js — managed solely via /api/auth/users routes).

-- ------------------------------------------------------------
-- 2. pl_user_roles bootstrap  (table created in the project-pl module)
--    Black and Marketing are the Finance administrators.
-- ------------------------------------------------------------
INSERT INTO pl_user_roles (email, role, notes)
VALUES
  ('lee@hggroup.com.my',       'Admin', 'bootstrap admin'),
  ('marketing@hggroup.com.my', 'Admin', 'bootstrap admin · Finance UI/UX administration')
ON DUPLICATE KEY UPDATE
  role = 'Admin',
  notes = VALUES(notes),
  updated_at = NOW(),
  updated_by = 'schema-finance-home';

-- ------------------------------------------------------------
-- 3. No new tables, no MySQL views kept.
--    hub_pl_project_financials_v1 is a heavy multi-CTE view (FILTER clauses,
--    conditional cost rules, invoice fallback logic) — NOT trivially
--    translatable, ported as an RPC below. Everything else is a
--    jsonb-returning function.
-- ------------------------------------------------------------

-- RPC-PORT: hub_pl_project_financials_v1 (view, one row per project) — per-project financial parity rollup: subtotal from pl_job_scopes (client_amount w/ rate fallback), subcon committed (scope subcon + pl_subcon_charges lump − pl_materials InHouseSubcon deduction), supplier material cost (pl_materials non-InHouseSubcon), manpower cost (pl_manpower), internal cost (OtherDivision scopes), estimated-cost count/value, SST + discount/adjustment → computed invoice total with invoice_amount fallback (invoice_evidence / used_computed_invoice flags), credits/refunds (pl_credit_notes), received (pl_client_payments), paid subcon/supplier (pl_subcon_payments, pl_supplier_payments) → invoiced, net_revenue, total_cost, profit, margin, client/subcontractor/supplier outstanding. Reads: pl_projects, pl_job_scopes, pl_materials, pl_subcon_charges, pl_manpower, pl_client_payments, pl_subcon_payments, pl_supplier_payments, pl_credit_notes.
-- RPC-PORT: hub_my_home_mode() — returns the signed-in user's home_mode ('operations'|'executive') by matching the session email against allowed_users. Reads: allowed_users.
-- RPC-PORT: hub_is_executive() — returns true when the signed-in user's allowed_users row has home_mode = 'executive'; gate check used by hub_executive_home_v1. Reads: allowed_users.
-- RPC-PORT: hub_executive_home_v1(p_as_of date, p_attention_limit int) — protected Executive Home JSON summary (requires hub_is_executive; finance block additionally requires pl_role() in Admin/Manager): snapshot KPIs (open quotations from quotes Draft/Sent; active projects, net revenue MTD, client outstanding, profit MTD + margin from hub_pl_project_financials_v1 rollup), execution counters (dispatch dsp_alarms + dsp_jobs active/permit/at-risk/blocked/ready; workforce wkr_alarms expired/due 7/30 days; scaffold+storage scf_alarms/str_alarms overdue/due; inventory low-stock from inv_materials vs inv_purchase_lines − inv_stock_out_lines on-hand), severity-ranked attention items (loss-making projects, dispatch/workforce/scaffold/storage alarms, low stock; sorted critical→warning→watch, capped at p_attention_limit 1..100), last-25 activity feed mapped to tool names from audit_log, data-quality flags (computed invoice fallback used, missing invoice date), per-domain 'unavailable' fallbacks when a source errors. Reads: allowed_users, quotes, hub_pl_project_financials_v1 (i.e. all pl_* tables above), pl_user_roles (via pl_role), dsp_alarms, dsp_jobs, wkr_alarms, scf_alarms, str_alarms, inv_materials, inv_purchase_lines, inv_stock_out_lines, audit_log.
-- RPC-PORT: hub_finance_home_v1(p_as_of date, p_attention_limit int) — protected Finance Home JSON summary (requires pl_role() in Admin/Manager): portfolio snapshot (client/subcontractor/supplier outstanding, net revenue, project profit, average margin from hub_pl_project_financials_v1, excluding cancelled), attention items (loss-making active projects critical, estimated-cost projects warning, plus invoice due-date alarms from scf_alarms [type invoice], str_alarms [INVOICE_OVERDUE/INVOICE_DUE], trn_alarms [INVOICE_OVERDUE]; severity+due-date+amount ranked, capped at p_attention_limit 1..100), work queues (receivables: project outstanding + overdue operational invoice balances from scf_invoices/scf_payments, str_invoices/str_payments, trn_invoices/trn_payments; payables: subcon/supplier outstanding; claims_expenses: clm_claims submitted + exp_expenses business MTD; invoice_production: sci_invoices MTD + open quotes), last-20 finance-filtered activity feed from audit_log. Reads: pl_user_roles (via pl_role), hub_pl_project_financials_v1 (i.e. all pl_* tables above), scf_alarms, str_alarms, trn_alarms, scf_invoices, scf_payments, str_invoices, str_payments, trn_invoices, trn_payments, clm_claims, exp_expenses, sci_invoices, quotes, audit_log.
